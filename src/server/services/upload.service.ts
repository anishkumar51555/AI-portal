import { AppError } from "@/domain/errors";
import type { PresignBody } from "@/domain/schemas/upload";
import { stagingKey } from "@/domain/storage-keys";
import {
  createPresignedUpload,
  type PresignedUpload,
} from "@/server/storage/storage.service";
import { RATE_LIMITS, enforce } from "@/server/services/rate-limit.service";
import { env } from "@/lib/env";

/**
 * Step 1 of publishing: mint a constrained, short-lived upload URL.
 *
 * Spec: docs/03-api-contract.md §3.6 · docs/04 Flow 3
 * Features: F3.10, F3.11, F3.21
 */

export async function presignUpload(
  userId: string,
  body: PresignBody,
): Promise<PresignedUpload> {
  // Rate limit AFTER auth so it keys on the user, and BEFORE the work so a
  // flood costs nothing (rules/30). Throws a 429 carrying Retry-After.
  await enforce(RATE_LIMITS.presign, userId);

  // The declared size is checked here for a fast, readable failure. It is NOT
  // the enforcement point — `createPresignedUpload` attaches a
  // `content-length-range` condition so storage rejects an oversized body even
  // when the client lies about it or is a bare curl command.
  if (body.sizeBytes > env.MAX_UPLOAD_BYTES) {
    throw new AppError(
      "ARCHIVE_TOO_LARGE",
      `Archives are limited to ${Math.floor(env.MAX_UPLOAD_BYTES / 1_048_576)} MB. ` +
        `That file is ${(body.sizeBytes / 1_048_576).toFixed(1)} MB.`,
    );
  }

  // The key is derived, never accepted. `staging/{userId}/{ulid}.zip` — the
  // userId segment is what makes the ownership assertion at publish time
  // meaningful (docs/08 §4, threats 6 and 7).
  return createPresignedUpload(stagingKey(userId), body.contentType);
}
