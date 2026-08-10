import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type NoSuchKey,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import type { Readable } from "node:stream";
import { BUCKET, s3 } from "./client";
import { env } from "@/lib/env";
import { AppError } from "@/domain/errors";
import { downloadFilename } from "@/domain/storage-keys";

/**
 * Object storage operations.
 *
 * Programmed against the S3 API, never against a vendor (ADR-005) — MinIO
 * locally, Cloudflare R2 in production, and the code cannot tell the difference.
 *
 * Every function here takes a key that was derived by
 * `src/domain/storage-keys.ts`. None of them accept a key from a request body.
 *
 * Spec: docs/03-api-contract.md sections 3.6/3.9, docs/05-infrastructure.md section 4
 * Features: F2.1, F2.2, F2.3
 */

export interface PresignedUpload {
  /** Where the browser POSTs the multipart form. */
  url: string;
  /** Form fields that MUST be sent before the file part. */
  fields: Record<string, string>;
  key: string;
  expiresAt: string;
  maxSizeBytes: number;
}

/**
 * Mint a constrained upload URL.
 *
 * A presigned POST rather than a presigned PUT, specifically for
 * `content-length-range`: STORAGE ITSELF rejects an oversized or empty body.
 * A presigned PUT can only pin one exact length, and either way the client is
 * the one reporting it — so a client that lies, or is simply a curl command,
 * would sail past any check we did in the application.
 *
 * The size limit is therefore enforced twice: here by the bucket, and again by
 * a HeadObject before validation (docs/08 section 4, threat 5).
 */
export async function createPresignedUpload(
  key: string,
  contentType: string,
): Promise<PresignedUpload> {
  const ttl = env.PRESIGN_TTL_SECONDS;

  const { url, fields } = await createPresignedPost(s3, {
    Bucket: BUCKET,
    Key: key,
    Expires: ttl,
    Conditions: [
      // Minimum 1 byte: a zero-length upload is never a valid archive, and
      // rejecting it at the edge saves a pointless validation round trip.
      ["content-length-range", 1, env.MAX_UPLOAD_BYTES],
      ["eq", "$Content-Type", contentType],
    ],
    Fields: { "Content-Type": contentType },
  });

  return {
    // The browser must reach storage on its PUBLIC address, which differs from
    // the app's internal one whenever they are on separate networks.
    url: rewriteForBrowser(url),
    fields,
    key,
    expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    maxSizeBytes: env.MAX_UPLOAD_BYTES,
  };
}

export interface ObjectHead {
  sizeBytes: number;
  contentType: string | undefined;
  lastModified: Date | undefined;
}

/** Metadata without transferring the body. Returns null when absent. */
export async function headObject(key: string): Promise<ObjectHead | null> {
  try {
    const res = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return {
      sizeBytes: res.ContentLength ?? 0,
      contentType: res.ContentType,
      lastModified: res.LastModified,
    };
  } catch (err) {
    if (isNotFound(err)) return null;
    throw storageError("headObject", key, err);
  }
}

/**
 * Stream an object for inspection.
 *
 * Returns a Node Readable so `archive.inspector` can walk the zip WITHOUT ever
 * holding it in memory — the property the whole zip-bomb defence rests on.
 */
export async function getObjectStream(key: string): Promise<Readable> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    if (!res.Body) throw new Error("empty body");
    // The v3 SDK types Body as a union; in Node it is always a Readable.
    return res.Body as Readable;
  } catch (err) {
    if (isNotFound(err))
      throw new AppError("STAGING_NOT_FOUND", undefined, { context: { key } });
    throw storageError("getObjectStream", key, err);
  }
}

/** Upload a buffer. Used by the seed and template build, never by a request. */
export async function putObject(
  key: string,
  body: Buffer,
  contentType = "application/zip",
): Promise<void> {
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: body.byteLength,
      }),
    );
  } catch (err) {
    throw storageError("putObject", key, err);
  }
}

/**
 * Promote a staged object to its permanent key.
 *
 * A server-side copy: the bytes never re-traverse the network, so promoting a
 * 10 MB archive costs a single API call rather than a download plus an upload.
 */
export async function copyObject(sourceKey: string, destinationKey: string): Promise<void> {
  try {
    await s3.send(
      new CopyObjectCommand({
        Bucket: BUCKET,
        // CopySource is `{bucket}/{key}` and must be URI-encoded — a key with a
        // space or a plus sign silently copies the wrong object otherwise.
        CopySource: encodeURI(`${BUCKET}/${sourceKey}`),
        Key: destinationKey,
      }),
    );
  } catch (err) {
    if (isNotFound(err)) {
      throw new AppError("STAGING_NOT_FOUND", undefined, { context: { sourceKey } });
    }
    throw storageError("copyObject", `${sourceKey} -> ${destinationKey}`, err);
  }
}

/**
 * Delete an object.
 *
 * Never throws on a missing key. This runs on BOTH the success and the rejection
 * path of publishing, and a cleanup that can fail is a cleanup that gets skipped
 * — leaving unvalidated archives lying around.
 */
export async function deleteObject(key: string): Promise<void> {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch (err) {
    if (isNotFound(err)) return;
    throw storageError("deleteObject", key, err);
  }
}

/**
 * A short-lived download URL.
 *
 * The bucket is private, so this is the ONLY way bytes leave it. TTL is capped
 * at 300s: long enough to start a download, short enough that a leaked URL is
 * worthless by the time it is shared.
 */
export async function getSignedDownloadUrl(
  key: string,
  filenameBase: string,
  version: string,
): Promise<string> {
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      // Forces a download with a sensible filename instead of rendering the
      // archive inline or naming it after the opaque object key.
      ResponseContentDisposition: downloadFilename(filenameBase, version),
      ResponseContentType: "application/zip",
    }),
    { expiresIn: env.DOWNLOAD_TTL_SECONDS },
  );

  return rewriteForBrowser(url);
}

// ─────────────────────────── internals ───────────────────────────

/**
 * Swap the internal endpoint for the browser-facing one.
 *
 * In Docker the app may reach MinIO at `http://minio:9000` while the browser
 * must use `http://localhost:9000`. A presigned URL built from the internal
 * host is unreachable from the browser and fails with a DNS error that points
 * nowhere useful. When the two are the same (the usual case) this is a no-op.
 */
function rewriteForBrowser(url: string): string {
  const publicEndpoint = env.S3_PUBLIC_ENDPOINT;
  if (!publicEndpoint || publicEndpoint === env.S3_ENDPOINT) return url;
  return url.replace(env.S3_ENDPOINT, publicEndpoint);
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as Partial<NoSuchKey> & {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    e.name === "NoSuchKey" || e.name === "NotFound" || e.$metadata?.httpStatusCode === 404
  );
}

/**
 * Wrap a storage failure as an internal error.
 *
 * The provider's message can name buckets, hosts, and request ids, so it goes to
 * the log context and never into a response body (docs/12 section 4).
 */
function storageError(operation: string, key: string, cause: unknown): AppError {
  return new AppError("INTERNAL_ERROR", undefined, {
    context: {
      operation,
      key,
      cause: cause instanceof Error ? cause.message : String(cause),
    },
    cause,
  });
}
