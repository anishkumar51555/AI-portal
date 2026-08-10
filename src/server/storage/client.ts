import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@/lib/env";

/**
 * The S3-compatible storage client.
 *
 * Programmed against the S3 API, never against a vendor (ADR-005). MinIO
 * locally, Cloudflare R2 in production, AWS S3 or Azure Blob if that ever
 * changes — four environment variables separate them. The word "R2" appears in
 * exactly one file in this repo: .env.
 *
 * Phase 0 scope: the client and a health ping. The full service —
 * presign, head, copy, delete — arrives in Phase 2, task 2.3.
 */

const globalForS3 = globalThis as unknown as { s3?: S3Client };

function createClient(): S3Client {
  return new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    // MinIO addresses buckets as {endpoint}/{bucket}/{key}; R2 and AWS S3 use
    // virtual-host style ({bucket}.{endpoint}/{key}). Get this wrong and every
    // call fails with a 403 or a DNS error that says nothing useful.
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });
}

export const s3: S3Client = globalForS3.s3 ?? createClient();

if (env.NODE_ENV !== "production") {
  globalForS3.s3 = s3;
}

export const BUCKET = env.S3_BUCKET;

/** Readiness probe for GET /api/health?deep=1 (docs/03 section 3.1). */
export async function pingStorage(): Promise<{ ok: boolean; latencyMs: number }> {
  const started = performance.now();
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
    return { ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch {
    return { ok: false, latencyMs: Math.round(performance.now() - started) };
  }
}
