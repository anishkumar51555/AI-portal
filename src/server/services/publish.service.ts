import { AppError } from "@/domain/errors";
import { toDbType, toUrlType, type ComponentManifest } from "@/domain/schemas/manifest";
import type { PublishBody } from "@/domain/schemas/publish";
import { assertOwnStagingKey, componentKey } from "@/domain/storage-keys";
import type { SessionUser } from "@/server/auth/guards";
import { recordAuditEventSafely } from "@/server/repositories/audit.repository";
import {
  addVersionToComponent,
  createComponentWithVersion,
  findBySlug,
  findVersionByChecksum,
  type PublishResult,
} from "@/server/repositories/component.repository";
import { inspectArchive, type InspectionResult } from "@/server/services/archive.inspector";
import {
  validateManifest,
  type ExistingComponent,
} from "@/server/services/manifest.validator";
import { RATE_LIMITS, enforce } from "@/server/services/rate-limit.service";
import {
  copyObject,
  deleteObject,
  getObjectStream,
  headObject,
} from "@/server/storage/storage.service";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Component publishing — the two-phase stage → validate → promote pipeline.
 *
 * The ordering rules here are the ones that matter, and both are easy to get
 * subtly wrong:
 *
 *  1. **Promote storage BEFORE committing the database** (non-negotiable #7).
 *     An orphaned object costs a few KB and nobody notices. A catalog row
 *     pointing at a missing object is a 404 on the download button, which every
 *     visitor notices.
 *  2. **Delete the staging object on the rejection path too.** Forgetting this
 *     is called out in the plan as the most common bug in this phase: every
 *     failed upload would linger until the 24h lifecycle rule swept it, and a
 *     rejected archive is exactly the kind of thing not to keep lying around.
 *
 * Spec: docs/03-api-contract.md §3.7–3.8 · docs/04 Flow 3 · docs/01 §5.2
 * Features: F3.12–F3.17, F3.19, F3.20
 */

interface StagedArchive {
  inspection: InspectionResult;
  manifest: ComponentManifest;
}

/**
 * Everything between "the client says it uploaded something" and "we believe
 * it": ownership, existence, size, archive safety, manifest validity.
 *
 * Shared by both publish paths so a new version cannot skip a guard that a new
 * component applies.
 */
async function readAndValidateStaged(
  user: SessionUser,
  stagingKey: string,
  existing: ExistingComponent | null,
): Promise<StagedArchive> {
  // THE multi-tenant boundary. Checked before any storage call, because the key
  // is attacker-controlled and everything downstream trusts it (docs/08 §4,
  // threat 6). Throws STAGING_FORBIDDEN.
  assertOwnStagingKey(stagingKey, user.id);

  const head = await headObject(stagingKey);
  if (!head) {
    throw new AppError(
      "STAGING_NOT_FOUND",
      "That upload was not found. Presigned uploads expire — start the upload again.",
    );
  }

  // Re-check the size server-side even though the presigned POST already
  // constrained it. Belt and braces on the one limit that protects memory.
  if (head.sizeBytes > env.MAX_UPLOAD_BYTES) {
    throw new AppError(
      "ARCHIVE_TOO_LARGE",
      `Archives are limited to ${Math.floor(env.MAX_UPLOAD_BYTES / 1_048_576)} MB.`,
    );
  }

  const inspection = await inspectArchive(await getObjectStream(stagingKey));

  const manifest = validateManifest(inspection.manifestRaw, {
    archive: { paths: inspection.paths },
    existing,
  });

  return { inspection, manifest };
}

/**
 * Promote the staged object to its permanent key, then remove the staging copy.
 *
 * A server-side copy: the bytes never traverse the app server, so promoting a
 * 10 MB archive is one API call rather than a download plus an upload.
 */
async function promote(stagingKey: string, objectKey: string): Promise<void> {
  await copyObject(stagingKey, objectKey);
  await deleteObject(stagingKey);
}

/**
 * Best-effort staging cleanup for a failed publish.
 *
 * Never throws: the caller is already on its way to reporting a real error, and
 * replacing a precise 422 with a storage failure would be strictly worse for
 * the publisher. A leaked object is swept by the 24h lifecycle rule.
 */
async function discardStaging(stagingKey: string, requestId?: string): Promise<void> {
  try {
    await deleteObject(stagingKey);
  } catch (err) {
    logger.warn({ err, stagingKey, requestId }, "failed to delete rejected staging object");
  }
}

/**
 * Record why an upload was refused.
 *
 * AWAITED, not fire-and-forget. A serverless function can freeze the instant it
 * responds, so an un-awaited write is a write that may never land — and the
 * rejection log is exactly what you want when investigating abuse. Awaiting is
 * safe because `recordAuditEventSafely` swallows its own errors: this can never
 * turn a precise 422 into a 500.
 */
async function auditRejection(
  user: SessionUser,
  reason: string,
  detail?: string,
): Promise<void> {
  await recordAuditEventSafely(
    {
      actorId: user.id,
      action: "UPLOAD_REJECTED",
      targetType: "User",
      targetId: user.id,
      // The CODE, never the archive contents or a secret that was detected.
      metadata: { reason, ...(detail ? { detail } : {}) },
    },
    (err) => logger.warn({ err }, "failed to write UPLOAD_REJECTED audit row"),
  );
}

/** Fields on `Component` that come from the manifest, for create and refresh alike. */
function describeFrom(manifest: ComponentManifest, readme: string | null) {
  return {
    summary: manifest.description,
    readme,
    license: manifest.license,
    homepage: manifest.homepage ?? null,
    repository: manifest.repository ?? null,
  };
}

function versionRow(
  manifest: ComponentManifest,
  inspection: InspectionResult,
  objectKey: string,
  body: PublishBody,
  userId: string,
) {
  return {
    version: manifest.version,
    manifest,
    objectKey,
    sizeBytes: inspection.sizeBytes,
    checksumSha256: inspection.checksumSha256,
    changelog: body.changelog,
    publishedById: userId,
  };
}

/**
 * `POST /api/components` — publish a brand-new component.
 */
export async function publishComponent(
  user: SessionUser,
  body: PublishBody,
  requestId?: string,
): Promise<PublishResult> {
  await enforce(RATE_LIMITS.publish, user.id);

  let staged: StagedArchive;
  try {
    staged = await readAndValidateStaged(user, body.stagingKey, null);
  } catch (err) {
    // The archive was rejected. Bin it and record why — but only after the
    // ownership check passed, or one user could delete another's staged upload
    // by guessing a key.
    if (!isOwnershipFailure(err)) await discardStaging(body.stagingKey, requestId);
    await auditRejection(user, codeOf(err));
    throw err;
  }

  const { inspection, manifest } = staged;
  const slug = manifest.name;

  try {
    await assertPublishable(slug, inspection.checksumSha256);
  } catch (err) {
    await discardStaging(body.stagingKey, requestId);
    await auditRejection(user, codeOf(err), slug);
    throw err;
  }

  const objectKey = componentKey(slug, manifest.version);
  await promote(body.stagingKey, objectKey);

  return createComponentWithVersion(
    {
      slug,
      name: manifest.name,
      displayName: manifest.displayName,
      type: toDbType(manifest.type),
      ownerId: user.id,
      ...describeFrom(manifest, inspection.readme),
    },
    versionRow(manifest, inspection, objectKey, body, user.id),
    dedupeTags(body.tags, manifest.keywords),
  );
}

/**
 * `POST /api/components/:slug/versions` — publish a new version.
 */
export async function publishVersion(
  user: SessionUser,
  slug: string,
  body: PublishBody,
  requestId?: string,
): Promise<PublishResult> {
  await enforce(RATE_LIMITS.publish, user.id);

  const existing = await findBySlug(slug);

  // 404 rather than 403 for someone else's component: a 403 confirms the thing
  // exists and turns this into an enumeration oracle (rules/50).
  if (!existing || existing.deletedAt !== null) {
    throw new AppError("NOT_FOUND", "No such component.");
  }
  if (existing.ownerId !== user.id && user.role !== "ADMIN") {
    throw new AppError("NOT_FOUND", "No such component.");
  }

  let staged: StagedArchive;
  try {
    staged = await readAndValidateStaged(user, body.stagingKey, {
      name: existing.name,
      type: toUrlType(existing.type),
      latestVersion: existing.latestVersion?.version ?? null,
    });
  } catch (err) {
    if (!isOwnershipFailure(err)) await discardStaging(body.stagingKey, requestId);
    await auditRejection(user, codeOf(err), slug);
    throw err;
  }

  const { inspection, manifest } = staged;

  try {
    await assertChecksumUnseen(inspection.checksumSha256);
  } catch (err) {
    await discardStaging(body.stagingKey, requestId);
    await auditRejection(user, codeOf(err), slug);
    throw err;
  }

  const objectKey = componentKey(slug, manifest.version);
  await promote(body.stagingKey, objectKey);

  return addVersionToComponent(
    existing.id,
    versionRow(manifest, inspection, objectKey, body, user.id),
    describeFrom(manifest, inspection.readme),
    dedupeTags(body.tags, manifest.keywords),
  );
}

// ─────────────────────────── uniqueness ───────────────────────────

async function assertPublishable(slug: string, checksum: string): Promise<void> {
  // Checksum BEFORE slug, deliberately. Retrying a publish that already
  // succeeded hits both conditions — and "this exact archive is already
  // published as pdf-extractor@1.0.0" tells the publisher what actually
  // happened, where "rename your component" would send them off to fix a
  // problem they do not have (docs/03 §3.7, idempotency).
  await assertChecksumUnseen(checksum);

  const existing = await findBySlug(slug);
  if (existing) {
    throw new AppError(
      "SLUG_TAKEN",
      `"${slug}" is already published. Rename your component, or publish a new version of it instead.`,
    );
  }
}

async function assertChecksumUnseen(checksum: string): Promise<void> {
  const duplicate = await findVersionByChecksum(checksum);
  if (duplicate) {
    throw new AppError(
      "DUPLICATE_ARCHIVE",
      `This exact archive is already published as ${duplicate.component.slug}@${duplicate.version}.`,
    );
  }
}

// ─────────────────────────── helpers ───────────────────────────

function codeOf(err: unknown): string {
  return AppError.is(err) ? err.code : "INTERNAL_ERROR";
}

/**
 * Was the failure the ownership check itself?
 *
 * If so the staging object is NOT ours to delete — otherwise a caller could
 * erase another user's pending upload just by naming its key.
 */
function isOwnershipFailure(err: unknown): boolean {
  return AppError.is(err) && err.code === "STAGING_FORBIDDEN";
}

/** Catalog tags: what the publisher asked for, plus the manifest's keywords. */
function dedupeTags(requested: readonly string[], keywords: readonly string[]): string[] {
  return [...new Set([...requested, ...keywords])].slice(0, 10);
}
