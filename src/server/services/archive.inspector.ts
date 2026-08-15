import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import { AppError } from "@/domain/errors";
import { env } from "@/lib/env";

/**
 * Archive safety inspection — the security boundary of the upload pipeline.
 *
 * Every guard here defends a consumer who EXTRACTS the archive, not this server:
 * the portal never writes an uploaded entry to disk. A zip-slip path is harmless
 * to us and catastrophic to the developer who unzips it (docs/08 §4).
 *
 * Two properties are load-bearing:
 *
 *  1. It aborts on the FIRST breach. A decompression bomb is never fully read.
 *  2. Every guard is checked against the entry's CENTRAL-DIRECTORY METADATA,
 *     before a single byte is decompressed. Sizes and paths are known upfront,
 *     so a 50 GB bomb is rejected without inflating any of it.
 *
 * Spec: docs/08-security-model.md §4, §4.2
 * Features: F3.1–F3.8
 */

export interface ArchiveLimits {
  maxEntries: number;
  maxUncompressedBytes: number;
  maxCompressionRatio: number;
  /** Cap on the COMPRESSED archive itself. */
  maxArchiveBytes: number;
}

export const DEFAULT_LIMITS: ArchiveLimits = {
  maxEntries: env.MAX_ARCHIVE_ENTRIES,
  maxUncompressedBytes: env.MAX_UNCOMPRESSED_BYTES,
  maxCompressionRatio: env.MAX_COMPRESSION_RATIO,
  maxArchiveBytes: env.MAX_UPLOAD_BYTES,
};

/** Caps on the two files we actually read out of the archive (docs/08 §4.2). */
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_README_BYTES = 100 * 1024;

export interface InspectionResult {
  /** SHA-256 of the raw archive bytes. Globally unique per docs/02 §2.2. */
  checksumSha256: string;
  sizeBytes: number;
  entryCount: number;
  uncompressedBytes: number;
  /** Every file path in the archive, POSIX-style, relative to the root. */
  paths: string[];
  /** Raw `component.json` text. Parsing is the validator's job, not ours. */
  manifestRaw: string;
  /** Raw `README.md` text, if present. */
  readme: string | null;
}

export interface InspectOptions {
  limits?: Partial<ArchiveLimits>;
  /**
   * Called for each entry as it is walked. Exists so a test can prove the walk
   * ABORTED EARLY rather than merely that it eventually threw — the early abort
   * is the actual defence against a bomb (rules/70).
   */
  onEntry?: (name: string, index: number) => void;
}

/** Reason codes, surfaced in `AppError.context` for logs and tests. */
export type UnsafeReason =
  | "TOO_MANY_ENTRIES"
  | "ABSOLUTE_PATH"
  | "PATH_TRAVERSAL"
  | "SYMLINK"
  | "BOMB_TOTAL"
  | "BOMB_RATIO";

function unsafe(reason: UnsafeReason, message: string): AppError {
  return new AppError("ARCHIVE_UNSAFE", message, { context: { reason } });
}

// ─────────────────────────── entry guards ───────────────────────────

/**
 * Unix mode lives in the HIGH 16 bits of `externalFileAttributes`, and
 * `S_IFLNK` (0xA000) marks a symlink.
 *
 * Only meaningful when the archive was created on a Unix-like system, which the
 * high byte of `versionMadeBy` reports as 3. On a DOS/Windows-made archive those
 * same bits hold DOS attributes, and a file with the archive+system bits set
 * would masquerade as a symlink.
 */
function isSymlink(entry: Entry): boolean {
  const madeByUnix = entry.versionMadeBy >> 8 === 3;
  if (!madeByUnix) return false;
  return ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000;
}

/**
 * Normalise an entry name for path checks.
 *
 * Backslashes become forward slashes FIRST: a Windows-style `..\..\evil.txt`
 * would otherwise sail past a check that only splits on `/`.
 */
function normalizeName(raw: string): string {
  return raw.replace(/\\/g, "/");
}

function assertSafePath(name: string): void {
  if (name.startsWith("/")) {
    throw unsafe("ABSOLUTE_PATH", `Entry "${name}" has an absolute path.`);
  }
  // `C:/…` after normalisation — a Windows drive prefix.
  if (/^[A-Za-z]:/.test(name)) {
    throw unsafe("ABSOLUTE_PATH", `Entry "${name}" has a Windows drive path.`);
  }
  if (name.split("/").includes("..")) {
    throw unsafe(
      "PATH_TRAVERSAL",
      `Entry "${name}" escapes the archive root with a ".." segment.`,
    );
  }
}

// ─────────────────────────── reading ───────────────────────────

/**
 * Read a stream into a Buffer, aborting past `limit`.
 *
 * The cap is checked as chunks arrive, not after: reading the whole thing and
 * then measuring it is exactly the memory exhaustion the limit exists to stop.
 */
async function readCapped(stream: Readable, limit: number, what: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of stream) {
    const buf = chunk as Buffer;
    total += buf.byteLength;
    if (total > limit) {
      stream.destroy();
      throw new AppError(
        "ARCHIVE_TOO_LARGE",
        `${what} exceeds ${Math.floor(limit / 1024)} KB.`,
      );
    }
    chunks.push(buf);
  }

  return Buffer.concat(chunks);
}

/**
 * Buffer the archive so yauzl can read it.
 *
 * A zip's central directory lives at the END of the file, so a zip reader needs
 * random access — genuinely streaming zip parsing is not possible. That is fine
 * here, and worth being precise about: what must never be buffered is the
 * DECOMPRESSED content, which is unbounded (a 10 MB bomb expands to gigabytes).
 * The COMPRESSED archive is hard-capped at `maxArchiveBytes` by the presigned
 * POST, by a HeadObject re-check, and again right here.
 */
async function bufferArchive(source: Buffer | Readable, limit: number): Promise<Buffer> {
  if (Buffer.isBuffer(source)) {
    if (source.byteLength > limit) {
      throw new AppError(
        "ARCHIVE_TOO_LARGE",
        `Archive exceeds ${Math.floor(limit / 1_048_576)} MB.`,
      );
    }
    return source;
  }
  return readCapped(source, limit, "Archive");
}

function openZip(buffer: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      {
        lazyEntries: true,
        // Do NOT let yauzl validate or decode entry names. Its own checks throw
        // a generic Error for a hostile path, which would surface as a 500
        // instead of the 422 the contract requires — and it rejects some names
        // before we can report WHICH guard they broke. We decode and validate
        // ourselves below.
        decodeStrings: false,
      },
      (err, zip) => {
        if (err ?? !zip) {
          return reject(
            new AppError("ARCHIVE_INVALID", "The upload is not a readable ZIP archive."),
          );
        }
        resolve(zip);
      },
    );
  });
}

function openEntryStream(zip: ZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err ?? !stream) {
        return reject(
          new AppError("ARCHIVE_INVALID", "An archive entry could not be read."),
        );
      }
      resolve(stream);
    });
  });
}

// ─────────────────────────── the walk ───────────────────────────

/**
 * Walk every entry, enforcing each guard, and pull out the two files we need.
 *
 * Written against yauzl's callback API with `lazyEntries: true` so exactly one
 * entry is in flight at a time — that is what makes "abort on first breach"
 * real rather than nominal.
 */
async function walk(
  zip: ZipFile,
  limits: ArchiveLimits,
  onEntry: InspectOptions["onEntry"],
): Promise<{
  entryCount: number;
  uncompressedBytes: number;
  paths: string[];
  manifestRaw: string | null;
  readme: string | null;
  nestedManifestPath: string | null;
}> {
  let entryCount = 0;
  let uncompressedBytes = 0;
  const paths: string[] = [];
  let manifestRaw: string | null = null;
  let readme: string | null = null;
  let nestedManifestPath: string | null = null;

  return new Promise((resolve, reject) => {
    const fail = (err: unknown) => {
      // Stop the walk immediately. Without this yauzl keeps emitting entries
      // after we have already decided to reject.
      zip.close();
      reject(err);
    };

    zip.on("error", () =>
      fail(new AppError("ARCHIVE_INVALID", "The archive is corrupt or truncated.")),
    );

    zip.on("entry", (entry: Entry) => {
      void (async () => {
        try {
          // decodeStrings:false gives a Buffer. Decode as UTF-8 ourselves.
          const rawName = Buffer.isBuffer(entry.fileName)
            ? entry.fileName.toString("utf8")
            : String(entry.fileName);
          const name = normalizeName(rawName);

          entryCount += 1;
          onEntry?.(name, entryCount);

          if (entryCount > limits.maxEntries) {
            throw unsafe(
              "TOO_MANY_ENTRIES",
              `Archive has more than ${limits.maxEntries} entries.`,
            );
          }

          assertSafePath(name);
          if (isSymlink(entry)) {
            throw unsafe("SYMLINK", `Entry "${name}" is a symbolic link.`);
          }

          // Directory entries carry no content and no meaningful sizes.
          const isDirectory = name.endsWith("/");
          if (!isDirectory) {
            uncompressedBytes += entry.uncompressedSize;
            if (uncompressedBytes > limits.maxUncompressedBytes) {
              throw unsafe(
                "BOMB_TOTAL",
                `Archive expands to more than ${Math.floor(limits.maxUncompressedBytes / 1_048_576)} MB.`,
              );
            }
            // Ratio is per entry, so one pathological file is caught even when
            // the total is still under the cap.
            if (
              entry.compressedSize > 0 &&
              entry.uncompressedSize / entry.compressedSize > limits.maxCompressionRatio
            ) {
              throw unsafe(
                "BOMB_RATIO",
                `Entry "${name}" compresses at more than ${limits.maxCompressionRatio}:1.`,
              );
            }

            paths.push(name);

            if (name === "component.json") {
              const stream = await openEntryStream(zip, entry);
              manifestRaw = (
                await readCapped(stream, MAX_MANIFEST_BYTES, "component.json")
              ).toString("utf8");
            } else if (name === "README.md") {
              const stream = await openEntryStream(zip, entry);
              readme = (await readCapped(stream, MAX_README_BYTES, "README.md")).toString(
                "utf8",
              );
            } else if (nestedManifestPath === null && name.endsWith("/component.json")) {
              // Remember the first one, for the "you zipped the folder" hint.
              nestedManifestPath = name;
            }
          }

          zip.readEntry();
        } catch (err) {
          fail(err);
        }
      })();
    });

    zip.on("end", () => {
      resolve({
        entryCount,
        uncompressedBytes,
        paths,
        manifestRaw,
        readme,
        nestedManifestPath,
      });
    });

    zip.readEntry();
  });
}

// ─────────────────────────── public API ───────────────────────────

/**
 * Inspect an uploaded archive and extract what publishing needs.
 *
 * Throws `AppError` with a code from the closed taxonomy (docs/03 §1.2) on the
 * first guard breach — never a bare Error, which would surface as a 500.
 */
export async function inspectArchive(
  source: Buffer | Readable,
  options: InspectOptions = {},
): Promise<InspectionResult> {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };

  const buffer = await bufferArchive(source, limits.maxArchiveBytes);

  // Hash the raw bytes, not the entries: the checksum must identify the exact
  // object stored, and re-zipping identical files produces different bytes.
  const checksumSha256 = createHash("sha256").update(buffer).digest("hex");

  const zip = await openZip(buffer);
  const walked = await walk(zip, limits, options.onEntry);

  if (walked.manifestRaw === null) {
    throw new AppError(
      "MANIFEST_MISSING",
      walked.nestedManifestPath !== null
        ? `No component.json at the archive root — found "${walked.nestedManifestPath}" instead. ` +
            `Zip the folder's CONTENTS, not the folder itself (\`npm run pack\` does this for you).`
        : "The archive has no component.json at its root.",
    );
  }

  return {
    checksumSha256,
    sizeBytes: buffer.byteLength,
    entryCount: walked.entryCount,
    uncompressedBytes: walked.uncompressedBytes,
    paths: walked.paths,
    manifestRaw: walked.manifestRaw,
    readme: walked.readme,
  };
}
