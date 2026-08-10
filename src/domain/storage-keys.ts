import { ulid } from "ulid";
import { AppError } from "./errors";

/**
 * Object-key derivation.
 *
 * THE RULE: the client never supplies a storage key. Every key in this system is
 * produced by one of the functions below.
 *
 * A client-supplied key is a bucket-wide write primitive. Given one, a crafted
 * value like `../../templates/skill/1.0.0/skill-template-1.0.0.zip` overwrites an
 * official template for every future downloader. There is no clever validation
 * that makes accepting keys safe — the fix is to never accept them.
 *
 * These are pure functions in domain/ so the boundary is testable without a
 * bucket, and so no storage code can quietly grow its own key format.
 *
 * Spec: docs/05-infrastructure.md section 4, docs/08-security-model.md section 4
 */

export const STAGING_PREFIX = "staging";
export const COMPONENTS_PREFIX = "components";
export const TEMPLATES_PREFIX = "templates";

/** Characters a key segment may contain. Everything else is rejected. */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * Where an upload lands BEFORE validation.
 *
 * ULID rather than UUID: lexicographically sortable by creation time, so a
 * bucket listing is chronological and the 24h lifecycle sweep is easy to reason
 * about. Unguessable either way.
 */
export function stagingKey(userId: string): string {
  assertSafeSegment(userId, "userId");
  return `${STAGING_PREFIX}/${userId}/${ulid()}.zip`;
}

/** The permanent, write-once key for a validated release. */
export function componentKey(slug: string, version: string): string {
  assertSafeSegment(slug, "slug");
  assertSafeSegment(version, "version");
  return `${COMPONENTS_PREFIX}/${slug}/${version}/${slug}-${version}.zip`;
}

/** Portal-authored starter archives. */
export function templateKey(urlType: string, version: string): string {
  assertSafeSegment(urlType, "type");
  assertSafeSegment(version, "version");
  return `${TEMPLATES_PREFIX}/${urlType}/${version}/${urlType}-template-${version}.zip`;
}

/**
 * THE MULTI-TENANT ISOLATION BOUNDARY.
 *
 * Called before ANY storage operation on a staging key. Without it, user A can
 * pass user B's staging key to POST /api/components and publish B's upload as
 * their own — a complete authorization bypass that no amount of session checking
 * catches, because A really is authenticated.
 *
 * Throws STAGING_FORBIDDEN (403). The offending key goes to the log context,
 * never to the response body.
 */
export function assertOwnStagingKey(key: string, userId: string): void {
  const expected = `${STAGING_PREFIX}/${userId}/`;

  if (!key.startsWith(expected) || key.includes("..") || key.includes("//")) {
    throw new AppError("STAGING_FORBIDDEN", undefined, {
      context: { key, userId, expectedPrefix: expected },
    });
  }

  // Exactly staging/{userId}/{one-segment}. A nested path would still satisfy
  // the prefix test while escaping the flat layout the lifecycle rule assumes.
  const rest = key.slice(expected.length);
  if (rest.length === 0 || rest.includes("/")) {
    throw new AppError("STAGING_FORBIDDEN", undefined, {
      context: { key, userId, reason: "unexpected key shape" },
    });
  }
}

/** Non-throwing form of the check above. */
export function isOwnStagingKey(key: string, userId: string): boolean {
  try {
    assertOwnStagingKey(key, userId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reject anything that could alter the shape of a key.
 *
 * An allowlist, not a denylist. A denylist has to anticipate every dangerous
 * character; this only has to permit the ones keys legitimately contain —
 * alphanumerics, dot, underscore, hyphen. Path separators, whitespace, control
 * characters, and everything else are excluded by omission.
 *
 * Defence in depth: slugs and versions are schema-validated long before they
 * reach here, but key construction is the last place a traversal could be
 * introduced, so it does not assume that happened.
 */
function assertSafeSegment(value: string, label: string): void {
  const bad =
    value.length === 0 ||
    value.length > 128 ||
    !SAFE_SEGMENT.test(value) ||
    value.includes("..") ||
    value.startsWith(".");

  if (bad) {
    throw new AppError("VALIDATION_ERROR", `Invalid ${label} for a storage key.`, {
      context: { label, value },
    });
  }
}

/** A safe `Content-Disposition` value for a download response. */
export function downloadFilename(base: string, version: string): string {
  const safe = `${base}-${version}.zip`.replace(/[^A-Za-z0-9._-]/g, "_");
  return `attachment; filename="${safe}"`;
}
