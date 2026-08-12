import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, it, expect } from "vitest";
import { manifestSchema, type ManifestType } from "@/domain/schemas/manifest";
import { checkAgainstArchive, findSecrets } from "@/domain/schemas/manifest-checks";
import { toFieldErrors } from "@/domain/errors";

/**
 * The four starter templates, checked against the SAME schema that validates
 * user uploads.
 *
 * Why this test exists: the templates are the spec's worked examples. If one
 * drifts out of conformance, every developer who starts from it inherits the
 * drift — and they find out at publish time, from an error message about code
 * they did not write. This turns that into a failing unit test instead.
 *
 * Features: F2.9, F2.10, F2.11
 * Spec: docs/07-template-catalog.md §2, §4
 */

const TEMPLATES_DIR = join(process.cwd(), "templates");
const SHARED_DIR = join(TEMPLATES_DIR, "_shared");
const TYPES: ManifestType[] = ["skill", "plugin", "agent", "mcp-gateway"];

const EXCLUDE_DIRS = new Set(["node_modules", "dist", ".dist", "coverage", ".git"]);

function collect(dir: string, base: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!EXCLUDE_DIRS.has(entry)) out.push(...collect(full, base));
      continue;
    }
    if (entry.startsWith(".env") && entry !== ".env.example") continue;
    out.push(relative(base, full).split(sep).join("/"));
  }
  return out;
}

/** The same merge the build script performs: template files + shared skeleton. */
function archivePathsFor(type: ManifestType): string[] {
  const own = collect(join(TEMPLATES_DIR, type), join(TEMPLATES_DIR, type));
  const shared = collect(SHARED_DIR, SHARED_DIR);
  const ownSet = new Set(own);
  return [...own, ...shared.filter((f) => !ownSet.has(f))];
}

/** Read a built archive's entry names and timestamps, in the order stored. */
async function readZipEntries(path: string): Promise<Array<{ name: string; date: Date }>> {
  const yauzl = (await import("yauzl")).default;
  return new Promise((resolve, reject) => {
    const out: Array<{ name: string; date: Date }> = [];
    yauzl.open(path, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      zip.on("entry", (entry: { fileName: string; getLastModDate: () => Date }) => {
        out.push({ name: entry.fileName, date: entry.getLastModDate() });
        zip.readEntry();
      });
      zip.on("end", () => resolve(out));
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}

function manifestFor(type: ManifestType): unknown {
  return JSON.parse(readFileSync(join(TEMPLATES_DIR, type, "component.json"), "utf8"));
}

describe("[F2.9] every template manifest satisfies the published spec", () => {
  it.each(TYPES)("%s validates against the real manifestSchema", (type) => {
    const result = manifestSchema.safeParse(manifestFor(type));

    // Surface the actual field errors — a bare `.success === true` failure
    // tells whoever broke it nothing about what to fix.
    const problems = result.success
      ? []
      : toFieldErrors(result.error).map((e) => `${e.path}: ${e.message}`);

    expect(problems).toEqual([]);
  });

  it.each(TYPES)("%s declares the type its directory name promises", (type) => {
    const parsed = manifestSchema.parse(manifestFor(type));
    expect(parsed.type).toBe(type);
  });

  it.each(TYPES)("%s carries no secret-shaped value in its manifest", (type) => {
    // Templates ship publicly and get copied verbatim. A credential pattern
    // here would be cloned into every project started from it.
    expect(findSecrets(manifestFor(type))).toEqual([]);
  });
});

describe("[F2.10] template manifests only declare files they actually ship", () => {
  it.each(TYPES)("%s: every declared path resolves inside the archive", (type) => {
    const parsed = manifestSchema.parse(manifestFor(type));
    expect(checkAgainstArchive(parsed, archivePathsFor(type))).toEqual([]);
  });

  it("fails when a declared path is missing — proving the check is load-bearing", () => {
    const parsed = manifestSchema.parse(manifestFor("skill"));
    const withoutInstructions = archivePathsFor("skill").filter((p) => p !== "SKILL.md");

    const errors = checkAgainstArchive(parsed, withoutInstructions);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.path).toBe("skill.instructions");
    expect(errors[0]?.message).toContain("SKILL.md");
  });
});

describe("[F2.11] archive layout", () => {
  it.each(TYPES)("%s puts component.json at the root, not in a subfolder", (type) => {
    // The single most common publishing mistake is zipping the FOLDER rather
    // than its CONTENTS, which buries the manifest one level down.
    expect(archivePathsFor(type)).toContain("component.json");
  });

  it.each(TYPES)("%s ships the entrypoint it names", (type) => {
    const parsed = manifestSchema.parse(manifestFor(type));
    expect(archivePathsFor(type)).toContain(parsed.entrypoint);
  });

  it.each(TYPES)("%s inherits the shared skeleton files", (type) => {
    const paths = archivePathsFor(type);
    for (const shared of ["tsconfig.json", ".gitignore", "docs/GETTING-STARTED.md"]) {
      expect(paths).toContain(shared);
    }
  });

  it.each(TYPES)("%s ships a README, which becomes its catalog page", (type) => {
    expect(archivePathsFor(type)).toContain("README.md");
  });

  it.each(TYPES)("%s never ships a real .env", (type) => {
    expect(archivePathsFor(type).filter((p) => p.split("/").pop() === ".env")).toEqual([]);
  });
});

describe("the template build is reproducible", () => {
  /**
   * Building twice with no source change must produce byte-identical archives.
   *
   * Two things break this, and both did during development: archiver stamps the
   * current mtime into each entry unless given a fixed `date`, and
   * `archive.file()` reads through an async queue so entries land in completion
   * order rather than call order. Either one makes the sha256 change on every
   * run, which reduces `Template.checksumSha256` to noise — nobody can verify a
   * download against a checksum that was never stable.
   *
   * Filesystem-only (no database, no network), so it belongs with the unit
   * tests despite shelling out.
   */
  it("stamps a fixed timestamp on every entry, in sorted order", async () => {
    execFileSync(process.execPath, ["--import", "tsx", "scripts/build-templates.mts"], {
      cwd: process.cwd(),
      stdio: "pipe",
    });

    const entries = await readZipEntries(
      join(TEMPLATES_DIR, ".dist", "skill-template-1.0.0.zip"),
    );

    // Testing this by "build twice and compare" would pass vacuously: both runs
    // land in the same second and a zip's DOS timestamp has two-second
    // granularity, so even a wall-clock build looks stable. Asserting the
    // mechanism is what actually catches the regression.
    for (const entry of entries) {
      expect(
        entry.date.toISOString(),
        `${entry.name} is not stamped with the fixed date`,
      ).toBe("2026-01-01T00:00:00.000Z");
    }

    // Order matters as much as the timestamps. `archive.file()` reads through
    // an async queue and writes entries in COMPLETION order, which varies run
    // to run; appending buffers in sorted order is what makes it stable.
    expect(entries.map((e) => e.name)).toEqual([...entries.map((e) => e.name)].sort());
  }, 120_000);
});
