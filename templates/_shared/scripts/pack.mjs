#!/usr/bin/env node
/**
 * Package this component for upload.
 *
 * Exists for exactly one reason: to make it impossible to get the zip layout
 * wrong. Selecting the folder in Explorer or Finder and choosing "Compress"
 * produces `my-component/component.json`, which the portal rejects with
 * MANIFEST_MISSING — and the error is baffling if you do not already know why.
 *
 *   npm run pack   ->   dist/<name>-<version>.zip
 */
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { ZipArchive } from "archiver";

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, "dist");

/** Never ship these — they are large, machine-specific, or secret. */
const EXCLUDE_DIRS = new Set(["node_modules", "dist", ".git", ".turbo", "coverage"]);
const EXCLUDE_FILES = new Set([".DS_Store", "Thumbs.db"]);

async function collect(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue;
      out.push(...(await collect(join(dir, entry.name))));
      continue;
    }
    if (EXCLUDE_FILES.has(entry.name)) continue;
    // .env holds real secrets; .env.example is names only and is safe to ship.
    if (entry.name.startsWith(".env") && entry.name !== ".env.example") continue;
    out.push(join(dir, entry.name));
  }
  return out;
}

const manifestPath = join(ROOT, "component.json");
let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch {
  console.error("No readable component.json here. Run this from the component root.");
  process.exit(1);
}

if (
  String(manifest.name).startsWith("my-") ||
  String(manifest.author?.name).includes("TODO")
) {
  console.warn(
    "\n  ⚠ component.json still has template placeholders (name / author).\n" +
      "    Publishing will work, but pick a real name first.\n",
  );
}

await mkdir(OUT_DIR, { recursive: true });
const outPath = join(OUT_DIR, `${manifest.name}-${manifest.version}.zip`);
await rm(outPath, { force: true });

const files = await collect(ROOT);
const archive = new ZipArchive({ zlib: { level: 9 } });
const sink = createWriteStream(outPath);

archive.on("error", (err) => {
  console.error(err);
  process.exit(1);
});
archive.pipe(sink);

for (const file of files) {
  // POSIX separators, relative to the root — this is what puts component.json
  // AT the archive root instead of one folder down.
  const name = relative(ROOT, file).split(sep).join("/");
  archive.file(file, { name });
}

await archive.finalize();
await new Promise((resolve) => sink.on("close", resolve));

const { size } = await stat(outPath);
console.log(
  `\n  ${relative(ROOT, outPath)}  (${(size / 1024).toFixed(1)} KB, ${files.length} files)`,
);
console.log("  component.json is at the archive root. Upload it at /publish\n");
