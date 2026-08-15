import { describe, it, expect } from "vitest";
import {
  validateManifest,
  tryValidateManifest,
} from "@/server/services/manifest.validator";
import { AppError } from "@/domain/errors";
import { clone, validSkill, validGateway } from "@tests/fixtures/manifests";

/**
 * The manifest validator.
 *
 * These tests are about ERROR QUALITY as much as correctness. Rejecting bad
 * input is what any schema does; telling a publisher exactly which field, at
 * which index, and what to do about it is the differentiating feature.
 *
 * Spec: docs/06 §5.1, §7 · docs/03 §1.2
 * Features: F3.9, F3.18
 *
 * NOT F3.14: that feature is "…and writes NO rows", which is a claim about
 * the publish endpoint's transaction. A unit test cannot verify it, so tagging
 * it here would mark it covered before the endpoint exists. It belongs to the
 * publish integration test in task 3.7–3.9.
 */

const json = (value: unknown) => JSON.stringify(value);

/** Run the validator and return the AppError it threw. */
function rejection(
  raw: string,
  options?: Parameters<typeof validateManifest>[1],
): AppError {
  try {
    validateManifest(raw, options);
  } catch (err) {
    expect(AppError.is(err), `expected an AppError, got ${String(err)}`).toBe(true);
    return err as AppError;
  }
  throw new Error("Expected validateManifest to throw, but it returned.");
}

describe("valid manifests", () => {
  it("returns the parsed manifest with defaults applied", () => {
    const manifest = validateManifest(json(validSkill));

    expect(manifest.type).toBe("skill");
    expect(manifest.name).toBe(validSkill.name);
    // `.default([])` in the schema means the caller never has to null-check.
    if (manifest.type === "skill") {
      expect(Array.isArray(manifest.skill.outputs)).toBe(true);
    }
  });

  it("accepts every one of the four component types", () => {
    for (const fixture of [validSkill, validGateway]) {
      expect(() => validateManifest(json(fixture))).not.toThrow();
    }
  });
});

describe("malformed JSON", () => {
  it("reports a parse failure as MANIFEST_INVALID, never a crash", () => {
    // A trailing comma is the single most common hand-edit mistake.
    const err = rejection('{ "specVersion": "1.0", }');

    expect(err.code).toBe("MANIFEST_INVALID");
    expect(err.status).toBe(422);
    expect(err.message).toContain("not valid JSON");
  });

  it("keeps the parser's position hint, which points at the character", () => {
    const err = rejection("{ not json at all }");
    expect(err.details?.[0]?.path).toBe("(root)");
    expect(err.details?.[0]?.message).toBeTruthy();
  });
});

describe("schema violations produce per-field details", () => {
  it("reports a dotted path the wizard can map to an input", () => {
    const bad = clone(validSkill);
    bad.version = "1.0"; // not semver

    const err = rejection(json(bad));

    expect(err.code).toBe("MANIFEST_INVALID");
    expect(err.details).toContainEqual(
      expect.objectContaining({
        path: "version",
        message: expect.stringContaining("semver"),
      }),
    );
  });

  it("reports EVERY problem at once, not just the first", () => {
    const bad = clone(validSkill);
    bad.version = "1.0";
    bad.description = "short"; // under the 10-char minimum
    bad.license = "WTFPL" as typeof bad.license;

    const err = rejection(json(bad));
    const paths = (err.details ?? []).map((d) => d.path);

    // Whack-a-mole — one error per upload — is the failure mode this prevents.
    expect(paths).toEqual(expect.arrayContaining(["version", "description", "license"]));
  });

  it("indexes into arrays so the exact element is addressable", () => {
    const bad = clone(validGateway);
    bad.mcp.tools[0]!.name = ""; // min(1)

    const err = rejection(json(bad));

    // `mcp.tools[0].name`, not `mcp,tools,0,name` — this is what lets the UI
    // highlight one field in a list of a hundred.
    expect((err.details ?? []).map((d) => d.path)).toContain("mcp.tools[0].name");
  });

  it("names an unrecognized key individually, not its parent block", () => {
    const bad = clone(validSkill) as Record<string, unknown>;
    bad.licence = "MIT"; // British spelling — a real and easy typo

    const err = rejection(json(bad));

    expect(err.details).toContainEqual(
      expect.objectContaining({
        path: "licence",
        message: expect.stringContaining("Unrecognized"),
      }),
    );
  });

  it("explains a bad discriminator instead of leaking Zod's wording", () => {
    const bad = clone(validSkill) as Record<string, unknown>;
    bad.type = "workflow";

    const err = rejection(json(bad));

    // A discriminated union cannot pick a branch, so every other field error is
    // suppressed. Saying that plainly beats "Invalid discriminator value".
    expect(err.message).toContain("skill, plugin, agent, mcp-gateway");
    expect(err.message).not.toContain("discriminator");
    expect(err.details).toHaveLength(1);
  });
});

describe("[F3.9] secret detection", () => {
  it("rejects a manifest carrying a credential", () => {
    const bad = clone(validGateway);
    bad.mcp.auth.envVars = ["GITHUB_TOKEN"];
    bad.description = `Uses token ghp_${"a".repeat(36)} for access.`;

    const err = rejection(json(bad));

    expect(err.code).toBe("MANIFEST_INVALID");
    expect(err.details?.length).toBeGreaterThan(0);
  });

  it("names the PATTERN and never echoes the secret back", () => {
    const secret = `ghp_${"b".repeat(36)}`;
    const bad = clone(validGateway);
    bad.description = `Authenticate with ${secret} please.`;

    const err = rejection(json(bad));
    const serialized = JSON.stringify({ message: err.message, details: err.details });

    // Echoing the value would leak it a second time — into logs, into an error
    // tracker, into a screenshot in a bug report.
    expect(serialized).not.toContain(secret);
    expect(serialized).toContain("GitHub");
  });
});

describe("cross-validation against the archive", () => {
  it("rejects a manifest declaring a file the archive does not ship", () => {
    const err = rejection(json(validSkill), {
      archive: { paths: ["component.json", "src/index.ts"] }, // no SKILL.md
    });

    expect(err.code).toBe("MANIFEST_INVALID");
    expect((err.details ?? []).map((d) => d.path)).toContain("skill.instructions");
  });

  it("passes when every declared path is present", () => {
    expect(() =>
      validateManifest(json(validSkill), {
        archive: {
          paths: ["component.json", validSkill.entrypoint, validSkill.skill.instructions],
        },
      }),
    ).not.toThrow();
  });
});

describe("immutable identity across versions", () => {
  it("refuses to rename a component", () => {
    const err = rejection(json(validSkill), {
      existing: { name: "something-else", type: "skill", latestVersion: "0.1.0" },
    });

    expect((err.details ?? []).map((d) => d.path)).toContain("name");
  });

  it("refuses to change a component's type", () => {
    const err = rejection(json(validSkill), {
      existing: { name: validSkill.name, type: "agent", latestVersion: "0.1.0" },
    });

    expect((err.details ?? []).map((d) => d.path)).toContain("type");
  });
});

describe("[F3.18] version must strictly increase", () => {
  const existing = (latestVersion: string) => ({
    existing: { name: validSkill.name, type: "skill" as const, latestVersion },
  });

  it("accepts a higher version", () => {
    expect(() => validateManifest(json(validSkill), existing("0.9.0"))).not.toThrow();
  });

  it("rejects republishing the same version as a 409, not a 422", () => {
    const err = rejection(json(validSkill), existing(validSkill.version));

    // Published versions are immutable (non-negotiable #4), so this is a
    // conflict with current state rather than a defect in the file.
    expect(err.code).toBe("VERSION_EXISTS");
    expect(err.status).toBe(409);
  });

  it("rejects going backwards", () => {
    const err = rejection(json(validSkill), existing("99.0.0"));

    expect(err.code).toBe("VERSION_NOT_INCREASING");
    expect(err.status).toBe(409);
  });

  it("compares numerically — 1.10.0 IS newer than 1.9.0", () => {
    const candidate = clone(validSkill);
    candidate.version = "1.10.0";

    // String comparison says "1.10.0" < "1.9.0", which would reject a
    // legitimate release. This is the exact bug the numeric compare exists for.
    expect(() =>
      validateManifest(json(candidate), {
        existing: { name: candidate.name, type: "skill", latestVersion: "1.9.0" },
      }),
    ).not.toThrow();
  });

  it("treats a pre-release as older than its release", () => {
    const candidate = clone(validSkill);
    candidate.version = "2.0.0-beta.1";

    const err = rejection(json(candidate), {
      existing: { name: candidate.name, type: "skill", latestVersion: "2.0.0" },
    });

    expect(err.code).toBe("VERSION_NOT_INCREASING");
  });

  it("skips the check for a brand-new component", () => {
    expect(() =>
      validateManifest(json(validSkill), {
        existing: { name: validSkill.name, type: "skill", latestVersion: null },
      }),
    ).not.toThrow();
  });
});

describe("tryValidateManifest", () => {
  it("returns the manifest on success instead of throwing", () => {
    const result = tryValidateManifest(json(validSkill));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest.name).toBe(validSkill.name);
  });

  it("returns every field error at once for the wizard's precheck", () => {
    const bad = clone(validSkill);
    bad.version = "nope";
    bad.description = "x";

    const result = tryValidateManifest(json(bad));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
      expect(result.errors.every((e) => typeof e.path === "string")).toBe(true);
    }
  });

  it("still surfaces a message when the error carries no field details", () => {
    // VERSION_EXISTS has no details[] — the precheck must not return an empty
    // list and leave the wizard with nothing to display.
    const result = tryValidateManifest(json(validSkill), {
      existing: { name: validSkill.name, type: "skill", latestVersion: validSkill.version },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.message).toContain("already published");
    }
  });
});
