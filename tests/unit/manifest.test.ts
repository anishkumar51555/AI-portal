import { describe, it, expect } from "vitest";
import {
  manifestSchema,
  toDbType,
  toUrlType,
  type ManifestType,
} from "@/domain/schemas/manifest";
import { toFieldErrors } from "@/domain/errors";
import {
  VALID_BY_TYPE,
  clone,
  validAgent,
  validGateway,
  validPlugin,
  validSkill,
} from "@tests/fixtures/manifests";

/**
 * The manifest specification.
 *
 * This suite carries a 95% coverage bar (vitest.config.ts) because the schema
 * IS the specification — a bug here corrupts the catalog for every consumer,
 * permanently, since published versions are immutable.
 *
 * Features: F2.4, F2.5, F2.6, F2.7, F2.8
 */

const TYPES = ["skill", "plugin", "agent", "mcp-gateway"] as const;

/** Parse and return field errors, asserting failure. */
function errorsFor(input: unknown) {
  const result = manifestSchema.safeParse(input);
  expect(result.success, "expected this manifest to be REJECTED").toBe(false);
  return toFieldErrors(result.error!);
}

function paths(input: unknown) {
  return errorsFor(input).map((e) => e.path);
}

describe("[F2.4] accepts a valid manifest of every type", () => {
  it.each(TYPES)("accepts the canonical %s fixture", (type) => {
    const result = manifestSchema.safeParse(VALID_BY_TYPE[type]);
    if (!result.success) console.error(toFieldErrors(result.error));
    expect(result.success).toBe(true);
  });

  it("applies documented defaults rather than leaving fields undefined", () => {
    const bare = clone(validSkill);
    // @ts-expect-error — deleting an optional-with-default to prove it is filled
    delete bare.skill.allowedTools;
    // @ts-expect-error — same
    delete bare.skill.examples;

    const parsed = manifestSchema.parse(bare);
    expect(parsed.type).toBe("skill");
    if (parsed.type === "skill") {
      expect(parsed.skill.allowedTools).toEqual([]);
      expect(parsed.skill.examples).toEqual([]);
    }
  });
});

describe("[F2.5] strict mode — unknown keys are errors, not noise", () => {
  it.each(TYPES)("rejects an unknown top-level key on a %s", (type) => {
    const m = { ...clone(VALID_BY_TYPE[type]), rogueField: "surprise" };
    expect(paths(m)).toContain("rogueField");
  });

  it("rejects a MISSPELLED field rather than silently dropping it", () => {
    // The whole reason for .strict(): "decsription" would otherwise be an
    // unknown key AND description would be missing — two bugs, zero warnings.
    const m = clone(validSkill) as Record<string, unknown>;
    m.decsription = m.description;
    delete m.description;

    const p = paths(m);
    expect(p).toContain("decsription"); // the typo is named
    expect(p).toContain("description"); // and the real field is reported missing
  });

  it("rejects unknown keys inside a nested block", () => {
    const m = clone(validGateway);
    (m.mcp as unknown as Record<string, unknown>).extraneous = true;
    expect(paths(m)).toContain("mcp.extraneous");
  });

  it("rejects unknown keys inside author", () => {
    const m = clone(validSkill);
    (m.author as unknown as Record<string, unknown>).twitter = "@x";
    expect(paths(m)).toContain("author.twitter");
  });
});

describe("[F2.6] field-level constraints", () => {
  it.each([
    ["1.0", "not three parts"],
    ["v1.0.0", "leading v"],
    ["^1.0.0", "a range, not a version"],
    ["1.0.0.0", "four parts"],
    ["01.0.0", "leading zero"],
    ["latest", "not a version at all"],
  ])("rejects version %s (%s)", (version) => {
    expect(paths({ ...clone(validSkill), version })).toContain("version");
  });

  it.each(["1.0.0", "0.0.1", "10.20.30", "1.0.0-beta.1", "1.0.0+build.5"])(
    "accepts valid semver %s",
    (version) => {
      expect(manifestSchema.safeParse({ ...clone(validSkill), version }).success).toBe(
        true,
      );
    },
  );

  it.each([
    ["PDF-Extractor", "uppercase"],
    ["pdf_extractor", "underscore"],
    ["-leading", "leading hyphen"],
    ["trailing-", "trailing hyphen"],
    ["", "empty"],
    ["a".repeat(65), "too long"],
  ])("rejects name %s (%s)", (name) => {
    expect(paths({ ...clone(validSkill), name })).toContain("name");
  });

  it("rejects a non-https homepage — this is an XSS control, not pedantry", () => {
    // These values land in href attributes on the detail page.
    expect(paths({ ...clone(validSkill), homepage: "http://example.com" })).toContain(
      "homepage",
    );
    expect(paths({ ...clone(validSkill), homepage: "javascript:alert(1)" })).toContain(
      "homepage",
    );
    expect(paths({ ...clone(validSkill), repository: "ftp://example.com" })).toContain(
      "repository",
    );
  });

  it("accepts an https homepage", () => {
    const m = { ...clone(validSkill), homepage: "https://example.com/x" };
    expect(manifestSchema.safeParse(m).success).toBe(true);
  });

  it("rejects a description that is too short or too long", () => {
    expect(paths({ ...clone(validSkill), description: "short" })).toContain("description");
    expect(paths({ ...clone(validSkill), description: "x".repeat(301) })).toContain(
      "description",
    );
  });

  it("requires at least one keyword and caps at ten", () => {
    expect(paths({ ...clone(validSkill), keywords: [] })).toContain("keywords");
    const many = Array.from({ length: 11 }, (_, i) => `kw-${i}`);
    expect(paths({ ...clone(validSkill), keywords: many })).toContain("keywords");
  });

  it("rejects a non-SPDX licence", () => {
    expect(paths({ ...clone(validSkill), license: "WTFPL" })).toContain("license");
    // An unlicensed component is legally unusable, so this is refused too.
    expect(paths({ ...clone(validSkill), license: "UNLICENSED" })).toContain("license");
  });

  it.each([
    ["/etc/passwd", "absolute"],
    ["../escape.ts", "parent traversal"],
    ["C:\\win\\x.ts", "drive prefix"],
    ["src\\index.ts", "backslashes"],
  ])("rejects entrypoint %s (%s)", (entrypoint) => {
    expect(paths({ ...clone(validSkill), entrypoint })).toContain("entrypoint");
  });

  it("rejects an unsupported specVersion so a future v2 cannot slip through a v1 validator", () => {
    expect(paths({ ...clone(validSkill), specVersion: "2.0" })).toContain("specVersion");
  });

  it("rejects an unknown component type", () => {
    expect(manifestSchema.safeParse({ ...clone(validSkill), type: "wizard" }).success).toBe(
      false,
    );
  });
});

describe("[F2.7] type-specific refinements", () => {
  it("skill: requires at least one trigger phrase", () => {
    const m = clone(validSkill);
    m.skill.triggers = [];
    expect(paths(m)).toContain("skill.triggers");
  });

  it("plugin: rejects a plugin that declares neither hooks nor commands", () => {
    const m = clone(validPlugin);
    m.plugin.hooks = [];
    m.plugin.commands = [];
    // A plugin that does nothing is not a plugin.
    expect(paths(m)).toContain("plugin.hooks");
  });

  it("plugin: accepts commands-only", () => {
    const m = clone(validPlugin);
    m.plugin.hooks = [];
    m.plugin.commands = [{ name: "hello", description: "Greet", handler: "src/hello.ts" }];
    expect(manifestSchema.safeParse(m).success).toBe(true);
  });

  it("agent: requires maxIterations — no unbounded loops", () => {
    const m = clone(validAgent);
    // @ts-expect-error — proving the field is required
    delete m.agent.maxIterations;
    expect(paths(m)).toContain("agent.maxIterations");
  });

  it("agent: caps maxIterations", () => {
    const m = clone(validAgent);
    m.agent.maxIterations = 1000;
    expect(paths(m)).toContain("agent.maxIterations");
  });

  it("agent: rejects a temperature outside 0-2", () => {
    const m = clone(validAgent);
    m.agent.model.temperature = 5;
    expect(paths(m)).toContain("agent.model.temperature");
  });

  it("mcp: stdio transport requires command", () => {
    const m = clone(validGateway);
    m.mcp.command = null;
    expect(paths(m)).toContain("mcp.transport");
  });

  it("mcp: http transport requires endpoint, not command", () => {
    const m = clone(validGateway);
    m.mcp.transport = "http";
    m.mcp.command = null;
    m.mcp.endpoint = null;
    expect(paths(m)).toContain("mcp.transport");

    const ok = clone(validGateway);
    ok.mcp.transport = "http";
    ok.mcp.command = null;
    ok.mcp.endpoint = "https://gateway.example.com/mcp";
    expect(manifestSchema.safeParse(ok).success).toBe(true);
  });

  it("mcp: rejects setting BOTH command and endpoint", () => {
    const m = clone(validGateway);
    m.mcp.endpoint = "https://example.com/mcp";
    expect(paths(m)).toContain("mcp.transport");
  });

  it("mcp: rejects duplicate tool names", () => {
    const m = clone(validGateway);
    m.mcp.tools = [
      { name: "query", description: "a", inputSchema: {}, readOnly: true },
      { name: "query", description: "b", inputSchema: {}, readOnly: true },
    ];
    expect(paths(m)).toContain("mcp.tools");
  });

  it("mcp: rejects a gateway exposing nothing at all", () => {
    const m = clone(validGateway);
    m.mcp.tools = [];
    m.mcp.resources = [];
    m.mcp.prompts = [];
    expect(paths(m)).toContain("mcp.tools");
  });

  it("mcp: envVars must be NAMES, so a lowercase value shape is rejected", () => {
    const m = clone(validGateway);
    m.mcp.auth.envVars = ["postgres://user:pass@host/db"];
    expect(paths(m)).toContain("mcp.auth.envVars[0]");
  });

  it("mcp: rejects a non-https endpoint", () => {
    const m = clone(validGateway);
    m.mcp.transport = "sse";
    m.mcp.command = null;
    m.mcp.endpoint = "http://insecure.example.com";
    expect(paths(m)).toContain("mcp.endpoint");
  });
});

describe("[F2.8] error paths are addressable by the UI", () => {
  it("renders nested array paths in bracket form", () => {
    const m = clone(validGateway);
    // @ts-expect-error — removing a required nested field
    delete m.mcp.tools[0].name;

    // tools[0].name, NOT tools,0,name — the bracket form is what lets the
    // upload wizard highlight the exact input that is wrong.
    expect(paths(m)).toContain("mcp.tools[0].name");
  });

  it("reports EVERY problem at once, not just the first", () => {
    // A publisher fixing five errors one round trip at a time gives up.
    const m = clone(validSkill) as Record<string, unknown>;
    m.version = "1.0";
    m.license = "NOPE";
    m.keywords = [];
    delete m.description;

    const p = paths(m);
    for (const field of ["version", "license", "keywords", "description"]) {
      expect(p, `expected ${field} to be reported`).toContain(field);
    }
  });

  it("carries a human-readable message on every error", () => {
    for (const e of errorsFor({ ...clone(validSkill), version: "1.0" })) {
      expect(e.message.length).toBeGreaterThan(0);
      expect(e.message).not.toMatch(/undefined|\[object/);
    }
  });

  it("reports only the matching branch's errors, thanks to the discriminated union", () => {
    // A plain z.union would report failures from all four branches at once,
    // including nonsense like "expected mcp" on a skill. This is the payoff.
    const p = paths({ ...clone(validSkill), version: "nope" });
    expect(p).toContain("version");
    expect(p.some((x) => x.startsWith("mcp") || x.startsWith("agent"))).toBe(false);
  });
});

describe("type conversion at the edge", () => {
  it("maps kebab-case manifest types to SCREAMING_SNAKE database enums", () => {
    expect(toDbType("mcp-gateway")).toBe("MCP_GATEWAY");
    expect(toDbType("skill")).toBe("SKILL");
  });

  it("round-trips both directions", () => {
    for (const t of TYPES) {
      expect(toUrlType(toDbType(t))).toBe(t);
    }
  });

  it("never leaks a database form into a URL form", () => {
    const urlForms: ManifestType[] = TYPES.map((t) => toUrlType(toDbType(t)));
    expect(urlForms.every((u) => u === u.toLowerCase())).toBe(true);
    expect(urlForms).toContain("mcp-gateway");
  });
});
