/**
 * Builds the hostile archive fixtures used by the archive-inspector tests.
 *
 * These are committed as generated output rather than binaries in git
 * (see .gitignore) so anyone can rebuild them and see exactly what makes each
 * one dangerous. They are the most convincing artifacts in the project —
 * six files that prove the upload path was designed against a threat model
 * rather than a happy path.
 *
 *   npm run fixtures:build
 *
 * Spec: docs/08-security-model.md §4, docs/11-testing-strategy.md §2.2
 */
// archiver 8 is ESM-native: no default export and no factory function.
// `Archiver` is the abstract base; `ZipArchive` is the concrete zip writer.
import { ZipArchive } from "archiver";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { crc32 as zlibCrc32 } from "node:zlib";

const OUT = join(process.cwd(), "tests", "fixtures", "archives");

const VALID_SKILL_MANIFEST = {
  $schema: "https://ai-portal.example/api/schemas/component-v1.json",
  specVersion: "1.0",
  name: "fixture-skill",
  displayName: "Fixture Skill",
  type: "skill",
  version: "1.0.0",
  description: "A minimal valid skill used as the happy-path test fixture.",
  author: { name: "Test Fixture" },
  license: "MIT",
  keywords: ["fixture", "testing"],
  runtime: { language: "typescript", minVersion: "20.0.0" },
  entrypoint: "src/index.ts",
  skill: {
    instructions: "SKILL.md",
    allowedTools: ["read_file"],
    triggers: ["run the fixture skill"],
    outputs: [{ name: "result", type: "string", description: "The skill output" }],
    examples: [],
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Raw ZIP writer — for the path-traversal fixtures ONLY.
//
// `archiver` runs every entry name through sanitizePath(), which strips "..",
// leading "/", and drive prefixes. That is correct, responsible behaviour and
// it means archiver physically cannot produce a malicious archive. So the
// three path-attack fixtures are forged byte by byte here, which is precisely
// what an attacker does — no honest library will do it for them.
//
// Stored (method 0), no compression, so the format stays readable.
// ─────────────────────────────────────────────────────────────────────────
interface RawEntry {
  name: string;
  data: string;
  /** Unix mode in the high 16 bits. Default 0o100644 (regular file). */
  externalAttrs?: number;
}

function rawZip(entries: RawEntry[]): Buffer {
  const DOS_TIME = 0x6000; // 12:00:00
  const DOS_DATE = 0x5921; // 2024-09-01
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8");
    const dataBuf = Buffer.from(e.data, "utf8");
    const crc = zlibCrc32(dataBuf);
    const attrs = e.externalAttrs ?? (0o100644 << 16) >>> 0;

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0); // local file header signature
    lfh.writeUInt16LE(20, 4); // version needed
    lfh.writeUInt16LE(0, 6); // flags
    lfh.writeUInt16LE(0, 8); // method: stored
    lfh.writeUInt16LE(DOS_TIME, 10);
    lfh.writeUInt16LE(DOS_DATE, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(dataBuf.length, 18); // compressed size
    lfh.writeUInt32LE(dataBuf.length, 22); // uncompressed size
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28); // extra length
    local.push(lfh, nameBuf, dataBuf);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0); // central directory signature
    cdh.writeUInt16LE(0x031e, 4); // version made by: UNIX, 3.0
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(0, 10);
    cdh.writeUInt16LE(DOS_TIME, 12);
    cdh.writeUInt16LE(DOS_DATE, 14);
    cdh.writeUInt32LE(crc, 16);
    cdh.writeUInt32LE(dataBuf.length, 20);
    cdh.writeUInt32LE(dataBuf.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30); // extra
    cdh.writeUInt16LE(0, 32); // comment
    cdh.writeUInt16LE(0, 34); // disk start
    cdh.writeUInt16LE(0, 36); // internal attrs
    cdh.writeUInt32LE(attrs, 38); // external attrs — carries the unix mode
    cdh.writeUInt32LE(offset, 42); // local header offset
    central.push(cdh, nameBuf);

    offset += lfh.length + nameBuf.length + dataBuf.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central directory
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...local, centralBuf, eocd]);
}

type Build = (a: ZipArchive) => void | Promise<void>;

/** A fixture is built either through archiver, or forged as raw bytes. */
interface Fixture {
  name: string;
  why: string;
  build?: Build;
  raw?: () => Buffer;
}

const MANIFEST_JSON = JSON.stringify(VALID_SKILL_MANIFEST);

const FIXTURES: Fixture[] = [
  {
    name: "valid.zip",
    why: "happy path — must pass every guard",
    build: (a) => {
      a.append(JSON.stringify(VALID_SKILL_MANIFEST, null, 2), { name: "component.json" });
      a.append("# Fixture Skill\n\nA valid component used in tests.\n", {
        name: "README.md",
      });
      a.append("# Instructions\n\nDo the thing.\n", { name: "SKILL.md" });
      a.append("export function execute() {\n  return 'ok';\n}\n", {
        name: "src/index.ts",
      });
    },
  },
  {
    name: "zip-slip.zip",
    why: "FORGED — entry escapes the extraction root via .. segments",
    raw: () =>
      rawZip([
        { name: "component.json", data: MANIFEST_JSON },
        { name: "../../evil.txt", data: "pwned" },
      ]),
  },
  {
    name: "absolute-path.zip",
    why: "FORGED — entry targets an absolute filesystem path",
    raw: () =>
      rawZip([
        { name: "component.json", data: MANIFEST_JSON },
        { name: "/etc/passwd", data: "root:x:0:0" },
      ]),
  },
  {
    name: "windows-path.zip",
    why: "FORGED — entry uses a Windows drive prefix and backslashes",
    raw: () =>
      rawZip([
        { name: "component.json", data: MANIFEST_JSON },
        { name: "C:\\Windows\\System32\\evil.dll", data: "evil" },
      ]),
  },
  {
    name: "bomb.zip",
    why: "~64 MB of zeros — expands well past the 50 MB uncompressed cap at a huge ratio",
    build: (a) => {
      a.append(JSON.stringify(VALID_SKILL_MANIFEST), { name: "component.json" });
      // 8 × 8 MB of zeros. Deflate compresses this to a few KB — that is the
      // whole point: small on the wire, enormous on disk.
      const chunk = Buffer.alloc(8 * 1024 * 1024, 0);
      for (let i = 0; i < 8; i++) a.append(chunk, { name: `payload/zeros-${i}.bin` });
    },
  },
  {
    name: "symlink.zip",
    why: "symlink entry pointing outside the archive",
    build: (a) => {
      a.append(JSON.stringify(VALID_SKILL_MANIFEST), { name: "component.json" });
      a.symlink("shadow-link", "/etc/shadow");
    },
  },
  {
    name: "too-many-entries.zip",
    why: "1500 entries — past the 1000 cap",
    build: (a) => {
      a.append(JSON.stringify(VALID_SKILL_MANIFEST), { name: "component.json" });
      for (let i = 0; i < 1500; i++) a.append("", { name: `flood/f${i}.txt` });
    },
  },
  {
    name: "no-manifest.zip",
    why: "no component.json anywhere",
    build: (a) => {
      a.append("# Just a readme\n", { name: "README.md" });
      a.append("console.log('hi');\n", { name: "src/index.ts" });
    },
  },
  {
    name: "nested-manifest.zip",
    why: "the #1 real user mistake — zipped the folder instead of its contents",
    build: (a) => {
      a.append(JSON.stringify(VALID_SKILL_MANIFEST), { name: "my-skill/component.json" });
      a.append("# My Skill\n", { name: "my-skill/README.md" });
      a.append("export {};\n", { name: "my-skill/src/index.ts" });
    },
  },
  {
    name: "invalid-manifest.zip",
    why: "structurally safe, schematically wrong — three deliberate field errors",
    build: (a) => {
      a.append(
        JSON.stringify({
          ...VALID_SKILL_MANIFEST,
          version: "1.0", //         ✗ not semver
          runtime: { minVersion: "20.0.0" }, // ✗ language missing
          rogueField: "surprise", //  ✗ unknown key, rejected by .strict()
        }),
        { name: "component.json" },
      );
      a.append("# Broken\n", { name: "README.md" });
      a.append("export {};\n", { name: "src/index.ts" });
    },
  },
  {
    name: "not-a-zip.zip",
    why: "wrong magic bytes — must fail as ARCHIVE_INVALID, not crash",
    raw: () => Buffer.from("this is definitely not a zip archive\n", "utf8"),
  },
];

async function writeArchive(name: string, build: Build): Promise<number> {
  const path = join(OUT, name);
  await rm(path, { force: true });

  return new Promise<number>((resolve, reject) => {
    const out = createWriteStream(path);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    out.on("close", () => resolve(archive.pointer()));
    archive.on("warning", (e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT") reject(e);
    });
    archive.on("error", reject);

    archive.pipe(out);
    void Promise.resolve(build(archive)).then(() => archive.finalize());
  });
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log(`Building hostile archive fixtures → ${OUT}\n`);

  for (const f of FIXTURES) {
    const path = join(OUT, f.name);
    if (f.raw) {
      await rm(path, { force: true });
      await writeFile(path, f.raw());
    } else if (f.build) {
      await writeArchive(f.name, f.build);
    } else {
      throw new Error(`Fixture ${f.name} declares neither build nor raw.`);
    }
    const { size } = await stat(path);
    const kb = (size / 1024).toFixed(1).padStart(8);
    console.log(`  ${f.name.padEnd(24)} ${kb} KB   ${f.why}`);
  }

  console.log(`\n${FIXTURES.length} fixtures written.`);
  console.log("Each one must be rejected with a specific error code — see docs/11 §2.2.");
}

await main();
