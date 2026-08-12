/**
 * Build, validate, and publish the four starter templates.
 *
 *   npm run templates:verify   validate only — no zip, no upload (CI uses this)
 *   npm run templates:build    validate, zip, checksum, upload to storage
 *
 * THE POINT OF THIS SCRIPT: templates are validated by the SAME manifest schema
 * that validates user uploads. There is exactly one validator, so a template
 * cannot silently drift from the spec it is supposed to teach. If someone edits
 * a template into an invalid state, CI fails — not a publisher, three weeks later.
 *
 * Spec: docs/07-template-catalog.md section 4
 * Features: F2.9, F2.10, F2.11
 */
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { ZipArchive } from "archiver";
import {
  manifestSchema,
  toDbType,
  type ManifestType,
} from "../src/domain/schemas/manifest.ts";
import { checkAgainstArchive } from "../src/domain/schemas/manifest-checks.ts";
import { toFieldErrors } from "../src/domain/errors.ts";

const ROOT = process.cwd();
const TEMPLATES_DIR = join(ROOT, "templates");
const SHARED_DIR = join(TEMPLATES_DIR, "_shared");
const OUT_DIR = join(TEMPLATES_DIR, ".dist");

const TYPES: ManifestType[] = ["skill", "plugin", "agent", "mcp-gateway"];

/** Fixed entry timestamp — see the comment in buildArchive() on reproducibility. */
const EPOCH = new Date("2026-01-01T00:00:00.000Z");

const EXCLUDE_DIRS = new Set(["node_modules", "dist", ".dist", "coverage", ".git"]);
const EXCLUDE_FILES = new Set([".DS_Store", "Thumbs.db"]);

const C = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};

interface FileEntry {
  /** Absolute path on disk. */
  source: string;
  /** POSIX path inside the archive, relative to its ROOT. */
  archivePath: string;
}

async function collect(dir: string, base: string): Promise<FileEntry[]> {
  const out: FileEntry[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      out.push(...(await collect(full, base)));
      continue;
    }
    if (EXCLUDE_FILES.has(entry.name)) continue;
    // .env would carry real secrets; .env.example is names only and ships.
    if (entry.name.startsWith(".env") && entry.name !== ".env.example") continue;

    out.push({ source: full, archivePath: relative(base, full).split(sep).join("/") });
  }
  return out;
}

/**
 * Merge the shared skeleton with a template's own files.
 *
 * `_shared/` holds the files that are byte-identical across all four templates
 * (tsconfig, .gitignore, GETTING-STARTED.md, pack.mjs) so they live in one place
 * rather than four. The ARCHIVE the user downloads is complete either way —
 * which is what F2.10 and F2.11 actually check.
 */
async function filesFor(type: ManifestType): Promise<FileEntry[]> {
  const templateDir = join(TEMPLATES_DIR, type);
  const own = await collect(templateDir, templateDir);
  const shared = await collect(SHARED_DIR, SHARED_DIR);

  // A template may override any shared file by shipping its own copy.
  const ownPaths = new Set(own.map((f) => f.archivePath));
  return [...own, ...shared.filter((f) => !ownPaths.has(f.archivePath))];
}

interface Validated {
  type: ManifestType;
  version: string;
  files: FileEntry[];
  manifest: ReturnType<typeof manifestSchema.parse>;
}

async function validate(type: ManifestType): Promise<Validated> {
  const files = await filesFor(type);
  const problems: string[] = [];

  // F2.11 — component.json must be at the archive ROOT, not one level down.
  // This is the single most common publishing mistake, so the templates
  // themselves are checked for it.
  const manifestEntry = files.find((f) => f.archivePath === "component.json");
  if (!manifestEntry) {
    throw new Error(
      `${type}: no component.json at the archive root (found: ` +
        `${files
          .map((f) => f.archivePath)
          .slice(0, 5)
          .join(", ")}…)`,
    );
  }

  // F2.9 — validated by the REAL schema, not a copy.
  const raw: unknown = JSON.parse(await readFile(manifestEntry.source, "utf8"));
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    for (const error of toFieldErrors(parsed.error)) {
      problems.push(`${error.path}: ${error.message}`);
    }
    throw new Error(`${type}: component.json is invalid\n  ${problems.join("\n  ")}`);
  }

  if (parsed.data.type !== type) {
    throw new Error(`${type}: manifest declares type "${parsed.data.type}"`);
  }

  // F2.10 — every path the manifest declares must actually be in the archive.
  const archivePaths = files.map((f) => f.archivePath);
  const missing = checkAgainstArchive(parsed.data, archivePaths);
  if (missing.length > 0) {
    throw new Error(
      `${type}: manifest declares files it does not ship\n  ` +
        missing.map((e) => `${e.path}: ${e.message}`).join("\n  "),
    );
  }

  return { type, version: parsed.data.version, files, manifest: parsed.data };
}

async function buildArchive(
  v: Validated,
): Promise<{ path: string; size: number; sha256: string }> {
  await mkdir(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, `${v.type}-template-${v.version}.zip`);
  await rm(outPath, { force: true });

  // Sorted, and read into memory BEFORE archiving. Both are required for a
  // reproducible archive, for different reasons:
  //
  //  - sort: readdir order is filesystem-dependent, so two machines would
  //    otherwise lay the same files out in a different order.
  //  - read first, then `append` a Buffer rather than `archive.file(path)`:
  //    archive.file() reads through an async queue, so entries are written in
  //    COMPLETION order, which varies run to run. Appending buffers is
  //    synchronous, so declaration order is the archive order.
  //
  // Templates are a few KB each, so holding one in memory costs nothing.
  const entries = await Promise.all(
    [...v.files]
      // Code-unit comparison, NOT localeCompare: locale collation varies with
      // the runtime's ICU data, so localeCompare would order entries
      // differently on different machines and defeat the reproducibility above.
      .sort((a, b) =>
        a.archivePath < b.archivePath ? -1 : a.archivePath > b.archivePath ? 1 : 0,
      )
      .map(async (file) => ({ name: file.archivePath, body: await readFile(file.source) })),
  );

  await new Promise<void>((resolve, reject) => {
    const sink = createWriteStream(outPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    sink.on("close", () => resolve());
    archive.on("error", reject);
    archive.pipe(sink);

    // `name` is the POSIX path relative to the template root — this is what
    // puts component.json AT the root rather than under a folder.
    //
    // `date` is fixed deliberately: otherwise archiver stamps each entry with
    // the file's current mtime, so rebuilding an UNCHANGED template yields a
    // different sha256 every time. A checksum that changes when nothing
    // changed cannot verify anything — and a fresh `git clone` (which sets
    // every mtime to checkout time) could never reproduce the published bytes.
    for (const entry of entries) {
      archive.append(entry.body, { name: entry.name, date: EPOCH });
    }
    void archive.finalize();
  });

  const buffer = await readFile(outPath);
  return {
    path: outPath,
    size: buffer.byteLength,
    sha256: createHash("sha256").update(buffer).digest("hex"),
  };
}

// ─────────────────────────────── main ───────────────────────────────

const verifyOnly = process.argv.includes("--verify-only");
const failures: string[] = [];
const built: Array<{
  type: ManifestType;
  version: string;
  size: number;
  sha256: string;
  files: number;
}> = [];

console.log(
  `\n${C.bold}${verifyOnly ? "Verifying" : "Building"} templates${C.reset} ${C.dim}(validated by the same schema as user uploads)${C.reset}\n`,
);

for (const type of TYPES) {
  try {
    const validated = await validate(type);

    if (verifyOnly) {
      console.log(
        `  ${C.green}✓${C.reset} ${type.padEnd(13)} ${C.dim}v${validated.version} · ${validated.files.length} files · manifest valid · all declared paths present${C.reset}`,
      );
      continue;
    }

    const archive = await buildArchive(validated);
    built.push({
      type,
      version: validated.version,
      size: archive.size,
      sha256: archive.sha256,
      files: validated.files.length,
    });

    console.log(
      `  ${C.green}✓${C.reset} ${type.padEnd(13)} ${C.dim}v${validated.version} · ${validated.files.length} files · ${(archive.size / 1024).toFixed(1)} KB · ${archive.sha256.slice(0, 12)}…${C.reset}`,
    );
  } catch (err) {
    failures.push(err instanceof Error ? err.message : String(err));
    console.log(`  ${C.red}✗${C.reset} ${type}`);
  }
}

if (failures.length > 0) {
  console.error(`\n${C.red}${C.bold}FAILED${C.reset}\n`);
  for (const failure of failures) console.error(`${failure}\n`);
  console.error(
    `${C.dim}A template that does not satisfy the manifest spec would teach publishers\n` +
      `the wrong shape. Fix the template — do not relax the schema.${C.reset}\n`,
  );
  process.exit(1);
}

if (verifyOnly) {
  console.log(`\n${C.green}All ${TYPES.length} templates satisfy spec v1.0.${C.reset}\n`);
} else {
  console.log(
    `\n${C.green}Built ${built.length} archives${C.reset} → ${relative(ROOT, OUT_DIR)}`,
  );
  console.log(
    `${C.dim}Upload them with the seed: npm run db:seed (reads ${relative(ROOT, OUT_DIR)})${C.reset}\n`,
  );

  // Emit an index of what was built so the seed does not re-derive sizes and
  // checksums — the seed must record the checksum of the EXACT bytes uploaded.
  await writeFile(
    join(OUT_DIR, "index.json"),
    `${JSON.stringify(
      built.map((b) => ({
        type: b.type,
        dbType: toDbType(b.type),
        version: b.version,
        sizeBytes: b.size,
        checksumSha256: b.sha256,
        fileName: `${b.type}-template-${b.version}.zip`,
      })),
      null,
      2,
    )}\n`,
  );
}
