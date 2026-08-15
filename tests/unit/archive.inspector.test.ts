import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, it, expect, vi } from "vitest";
import { inspectArchive } from "@/server/services/archive.inspector";
import { AppError } from "@/domain/errors";

/**
 * Archive safety guards.
 *
 * Every fixture here is a genuinely hostile archive, built byte-by-byte by
 * `npm run fixtures:build` and committed. These are the highest-value tests in
 * the project: each one is a real attack that the portal must refuse.
 *
 * Spec: docs/08-security-model.md §4
 * Features: F3.1–F3.8
 */

const FIXTURES = join(process.cwd(), "tests", "fixtures", "archives");

function fixture(name: string): Buffer {
  const path = join(FIXTURES, name);
  if (!existsSync(path)) {
    throw new Error(`Missing fixture ${name}. Run: npm run fixtures:build`);
  }
  return readFileSync(path);
}

/** Assert the call rejected with a specific AppError code and reason. */
async function expectRejection(
  archive: Buffer,
  code: string,
  reason?: string,
): Promise<AppError> {
  try {
    await inspectArchive(archive);
  } catch (err) {
    expect(AppError.is(err), `expected an AppError, got ${String(err)}`).toBe(true);
    const appError = err as AppError;
    expect(appError.code).toBe(code);
    if (reason) expect(appError.context?.reason).toBe(reason);
    return appError;
  }
  throw new Error(`Expected inspectArchive to reject with ${code}, but it resolved.`);
}

describe("a valid archive", () => {
  it("returns the manifest, readme, paths, and a checksum", async () => {
    const archive = fixture("valid.zip");
    const result = await inspectArchive(archive);

    expect(result.manifestRaw).toContain('"name"');
    expect(JSON.parse(result.manifestRaw)).toMatchObject({ type: "skill" });
    expect(result.readme).toContain("#");
    expect(result.paths).toContain("component.json");
    expect(result.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.sizeBytes).toBe(archive.byteLength);
    expect(result.entryCount).toBeGreaterThan(0);
  });

  it("[F3.6] computes the checksum over the raw archive bytes", async () => {
    const archive = fixture("valid.zip");
    const { createHash } = await import("node:crypto");

    const result = await inspectArchive(archive);

    // Must identify the exact stored object — this is what makes
    // ComponentVersion.checksumSha256 a duplicate detector and an integrity
    // guarantee rather than a decoration.
    expect(result.checksumSha256).toBe(createHash("sha256").update(archive).digest("hex"));
  });

  it("accepts a Readable as well as a Buffer", async () => {
    const archive = fixture("valid.zip");
    const result = await inspectArchive(Readable.from([archive]));
    expect(result.paths).toContain("component.json");
  });
});

describe("[F3.1] path traversal (zip-slip)", () => {
  it("rejects an entry containing a parent-directory segment", async () => {
    await expectRejection(fixture("zip-slip.zip"), "ARCHIVE_UNSAFE", "PATH_TRAVERSAL");
  });

  it("names the offending entry so the publisher can find it", async () => {
    const err = await expectRejection(fixture("zip-slip.zip"), "ARCHIVE_UNSAFE");
    expect(err.message).toContain("evil.txt");
  });

  it("[F3.2] rejects a POSIX absolute path", async () => {
    await expectRejection(fixture("absolute-path.zip"), "ARCHIVE_UNSAFE", "ABSOLUTE_PATH");
  });

  it("[F3.2] rejects a Windows drive path", async () => {
    await expectRejection(fixture("windows-path.zip"), "ARCHIVE_UNSAFE", "ABSOLUTE_PATH");
  });

  it("rejects backslash traversal with no drive letter", async () => {
    // `..\..\evil.txt` is the case that proves path normalisation is
    // load-bearing. Without converting "\" to "/" first, `split("/")` sees a
    // single harmless filename and waves it through — while Windows extracts it
    // as a genuine escape. The drive-letter check does NOT cover this one, so
    // windows-path.zip alone would leave the gap untested.
    await expectRejection(
      fixture("backslash-traversal.zip"),
      "ARCHIVE_UNSAFE",
      "PATH_TRAVERSAL",
    );
  });
});

describe("[F3.5] symlink escape", () => {
  it("rejects a symlink entry", async () => {
    await expectRejection(fixture("symlink.zip"), "ARCHIVE_UNSAFE", "SYMLINK");
  });
});

describe("[F3.3] decompression bomb", () => {
  it("rejects an archive that expands past the uncompressed cap", async () => {
    const err = await expectRejection(fixture("bomb.zip"), "ARCHIVE_UNSAFE");
    expect(["BOMB_TOTAL", "BOMB_RATIO"]).toContain(err.context?.reason);
  });

  it("aborts on the very first payload entry, inflating nothing", async () => {
    // The real defence is not "it eventually rejects" — it is that 64 MB of
    // zeros is never inflated. bomb.zip is component.json followed by 8 × 8 MB
    // payloads, and the per-entry ratio guard trips on the FIRST of them, so
    // exactly 2 entries are ever examined.
    //
    // Asserting the exact number rather than "less than 9" is what makes this
    // catch a regression that merely moves the check later.
    const onEntry = vi.fn();

    await expect(inspectArchive(fixture("bomb.zip"), { onEntry })).rejects.toMatchObject({
      code: "ARCHIVE_UNSAFE",
      context: { reason: "BOMB_RATIO" },
    });

    expect(onEntry.mock.calls.length).toBe(2);
  });

  it("also catches it on total size when the ratio guard is disarmed", async () => {
    // The two bomb guards are independent, and the ratio one fires first on
    // this fixture — so without disarming it the TOTAL branch would never be
    // exercised and could rot unnoticed. 8 × 8 MB overruns the 50 MB cap.
    await expect(
      inspectArchive(fixture("bomb.zip"), {
        limits: { maxCompressionRatio: Number.MAX_SAFE_INTEGER },
      }),
    ).rejects.toMatchObject({ code: "ARCHIVE_UNSAFE", context: { reason: "BOMB_TOTAL" } });
  });
});

describe("[F3.4] entry-count flood", () => {
  it("rejects an archive with more entries than the cap", async () => {
    await expectRejection(
      fixture("too-many-entries.zip"),
      "ARCHIVE_UNSAFE",
      "TOO_MANY_ENTRIES",
    );
  });

  it("stops at the cap instead of walking all 1500 entries", async () => {
    const onEntry = vi.fn();

    await expect(
      inspectArchive(fixture("too-many-entries.zip"), {
        limits: { maxEntries: 10 },
        onEntry,
      }),
    ).rejects.toMatchObject({ code: "ARCHIVE_UNSAFE" });

    // 11 = the ten allowed plus the one that broke the cap.
    expect(onEntry.mock.calls.length).toBe(11);
  });
});

describe("[F3.7] manifest presence", () => {
  it("rejects an archive with no component.json", async () => {
    await expectRejection(fixture("no-manifest.zip"), "MANIFEST_MISSING");
  });

  it("[F3.8] tells a publisher who zipped the FOLDER what they did wrong", async () => {
    const err = await expectRejection(fixture("nested-manifest.zip"), "MANIFEST_MISSING");

    // The single most common publishing mistake. A bare "no component.json" is
    // maddening when the file is plainly right there — so the message names the
    // path it found and the command that fixes it.
    expect(err.message).toContain("my-skill/component.json");
    expect(err.message).toContain("CONTENTS");
    expect(err.message).toContain("npm run pack");
  });

  it("passes an invalid manifest through as raw text, unparsed", async () => {
    // Structure is this module's job; MEANING is the validator's. Rejecting
    // here would produce ARCHIVE_INVALID for what is really MANIFEST_INVALID,
    // and the publisher would get the wrong error entirely.
    const result = await inspectArchive(fixture("invalid-manifest.zip"));
    expect(result.manifestRaw).toBeTruthy();
  });
});

describe("malformed input", () => {
  it("rejects a file that is not a ZIP at all", async () => {
    await expectRejection(fixture("not-a-zip.zip"), "ARCHIVE_INVALID");
  });

  it("rejects an archive larger than the compressed cap", async () => {
    await expect(
      inspectArchive(fixture("valid.zip"), { limits: { maxArchiveBytes: 100 } }),
    ).rejects.toMatchObject({ code: "ARCHIVE_TOO_LARGE" });
  });

  it("aborts an oversized STREAM without buffering all of it", async () => {
    // Reading it all and then measuring is the memory exhaustion the cap exists
    // to prevent, so the limit has to bite mid-stream.
    let produced = 0;
    const endless = new Readable({
      read() {
        produced += 64 * 1024;
        this.push(Buffer.alloc(64 * 1024, 0));
      },
    });

    await expect(
      inspectArchive(endless, { limits: { maxArchiveBytes: 256 * 1024 } }),
    ).rejects.toMatchObject({ code: "ARCHIVE_TOO_LARGE" });

    expect(produced).toBeLessThan(2 * 1024 * 1024);
  });

  it("never throws a bare Error — every failure carries a contract code", async () => {
    // A bare Error becomes a 500. Every rejection here must be a 4xx from the
    // closed taxonomy (docs/03 §1.2), or the publisher gets "something went
    // wrong" instead of an actionable message.
    const hostile = [
      "zip-slip.zip",
      "backslash-traversal.zip",
      "absolute-path.zip",
      "windows-path.zip",
      "symlink.zip",
      "bomb.zip",
      "too-many-entries.zip",
      "no-manifest.zip",
      "nested-manifest.zip",
      "not-a-zip.zip",
    ];

    for (const name of hostile) {
      const error = await inspectArchive(fixture(name)).catch((err: unknown) => err);
      expect(AppError.is(error), `${name} threw a non-AppError`).toBe(true);
      expect((error as AppError).status, `${name} status`).toBeLessThan(500);
    }
  });
});
