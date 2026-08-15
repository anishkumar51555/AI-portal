/**
 * Validates the hostile fixtures themselves.
 *
 * Its job is to prove each fixture actually contains the danger it claims to —
 * a "zip-slip" fixture with no `..` entry would let the real inspector test
 * pass while testing nothing.
 *
 * DELIBERATELY CARRIES NO FEATURE TAGS. It once tagged F3.1–F3.8, which are
 * statements about what the INSPECTOR rejects — so `npm run test:matrix`
 * reported those features as covered for days while no inspector existed. A
 * coverage tracker that can be satisfied without the feature being built is
 * worse than none, because it is trusted. Those tags now live in
 * `archive.inspector.test.ts`, where the behaviour is actually exercised.
 *
 * Rebuild the fixtures with: npm run fixtures:build
 */
import { describe, it, expect, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import yauzl from "yauzl";

const DIR = join(process.cwd(), "tests", "fixtures", "archives");

interface Entry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  isSymlink: boolean;
}

/**
 * Read a zip's entry table without extracting anything.
 *
 * `raw: true` sets yauzl's `decodeStrings: false`, which turns OFF yauzl's own
 * filename validation and hands back the bytes as they appear in the archive.
 *
 * This distinction drives a real implementation decision. With default options
 * yauzl throws on "..", absolute paths, and backslashes — useful defence in
 * depth, but it surfaces as an opaque Error that would become a 500. The real
 * archive.inspector therefore reads raw and runs its OWN guards, so every
 * rejection carries a precise code (ARCHIVE_UNSAFE / PATH_TRAVERSAL) and a
 * message a publisher can act on. See docs/08 §4.2.
 */
function listEntries(path: string, opts: { raw?: boolean } = {}): Promise<Entry[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, decodeStrings: !opts.raw }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error("no zipfile"));
      const entries: Entry[] = [];
      zip.on("entry", (e) => {
        entries.push({
          name: Buffer.isBuffer(e.fileName) ? e.fileName.toString("utf8") : e.fileName,
          compressedSize: e.compressedSize,
          uncompressedSize: e.uncompressedSize,
          // Unix mode lives in the top 16 bits; 0xA000 is S_IFLNK.
          isSymlink: ((e.externalFileAttributes >>> 16) & 0xf000) === 0xa000,
        });
        zip.readEntry();
      });
      zip.on("end", () => resolve(entries));
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}

const ALL = [
  "valid.zip",
  "zip-slip.zip",
  "absolute-path.zip",
  "windows-path.zip",
  "bomb.zip",
  "symlink.zip",
  "too-many-entries.zip",
  "no-manifest.zip",
  "nested-manifest.zip",
  "invalid-manifest.zip",
  "not-a-zip.zip",
];

describe("hostile archive fixtures", () => {
  beforeAll(() => {
    if (!existsSync(join(DIR, "valid.zip"))) {
      throw new Error("Fixtures missing. Run: npm run fixtures:build");
    }
  });

  it("all fixtures exist on disk", async () => {
    for (const name of ALL) {
      expect(existsSync(join(DIR, name)), `${name} missing`).toBe(true);
    }
  });

  it("valid.zip has component.json at the ROOT and passes every structural guard", async () => {
    const entries = await listEntries(join(DIR, "valid.zip"));
    const names = entries.map((e) => e.name);

    expect(names).toContain("component.json");
    expect(names.some((n) => n.endsWith("/component.json"))).toBe(false);

    expect(entries.length).toBeLessThanOrEqual(1000);
    expect(entries.some((e) => e.name.includes(".."))).toBe(false);
    expect(entries.some((e) => e.name.startsWith("/"))).toBe(false);
    expect(entries.some((e) => e.isSymlink)).toBe(false);
  });

  it("zip-slip.zip really contains a parent-directory escape", async () => {
    const entries = await listEntries(join(DIR, "zip-slip.zip"), { raw: true });
    const offender = entries.find((e) => e.name.split("/").includes(".."));
    expect(offender, "no entry with a '..' path segment").toBeDefined();
    expect(offender?.name).toBe("../../evil.txt");
  });

  it("absolute-path.zip really contains an absolute path", async () => {
    const entries = await listEntries(join(DIR, "absolute-path.zip"), { raw: true });
    expect(entries.some((e) => e.name.startsWith("/"))).toBe(true);
  });

  it("windows-path.zip really contains a drive-prefixed path", async () => {
    const entries = await listEntries(join(DIR, "windows-path.zip"), { raw: true });
    expect(entries.some((e) => /^[A-Za-z]:/.test(e.name.replace(/\\/g, "/")))).toBe(true);
  });

  // Defence in depth: yauzl's own filename validation catches these too. The
  // inspector must not RELY on it — an unmapped yauzl error becomes a 500
  // instead of a 422 with a usable message — but confirming it fires proves
  // the fixtures are hostile by any reader's standard, not just ours.
  it.each(["zip-slip.zip", "absolute-path.zip", "windows-path.zip"])(
    "%s is rejected by yauzl's own validation when strings are decoded",
    async (name) => {
      await expect(listEntries(join(DIR, name))).rejects.toThrow();
    },
  );

  it("bomb.zip is small on disk but expands past the 50 MB cap", async () => {
    const path = join(DIR, "bomb.zip");
    const onDisk = (await stat(path)).size;
    const entries = await listEntries(path);
    const expanded = entries.reduce((sum, e) => sum + e.uncompressedSize, 0);

    // Small enough to sail through the 10 MB upload limit...
    expect(onDisk).toBeLessThan(10 * 1024 * 1024);
    // ...but past the 50 MB uncompressed cap once expanded.
    expect(expanded).toBeGreaterThan(50 * 1024 * 1024);
    // And at a ratio far beyond the 100:1 per-entry guard.
    expect(expanded / onDisk).toBeGreaterThan(100);
  });

  it("too-many-entries.zip exceeds the 1000-entry cap", async () => {
    const entries = await listEntries(join(DIR, "too-many-entries.zip"));
    expect(entries.length).toBeGreaterThan(1000);
  });

  it("symlink.zip really contains a symlink entry", async () => {
    const entries = await listEntries(join(DIR, "symlink.zip"));
    expect(
      entries.some((e) => e.isSymlink),
      "no entry flagged as a symlink",
    ).toBe(true);
  });

  it("no-manifest.zip has no component.json anywhere", async () => {
    const entries = await listEntries(join(DIR, "no-manifest.zip"));
    expect(entries.some((e) => e.name.endsWith("component.json"))).toBe(false);
  });

  it("nested-manifest.zip has component.json exactly one level deep", async () => {
    const entries = await listEntries(join(DIR, "nested-manifest.zip"));
    const names = entries.map((e) => e.name);

    expect(names).not.toContain("component.json");
    const nested = names.find((n) => /^[^/]+\/component\.json$/.test(n));
    expect(nested, "expected a manifest one directory down").toBeDefined();
  });

  it("not-a-zip.zip does not have zip magic bytes", async () => {
    const buf = await readFile(join(DIR, "not-a-zip.zip"));
    expect(buf.subarray(0, 2).toString("latin1")).not.toBe("PK");
  });
});
