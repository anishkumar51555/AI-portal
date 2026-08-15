import type { Prisma } from "@prisma/client";
import type { ComponentManifest, DbComponentType } from "@/domain/schemas/manifest";
import { prisma } from "@/server/db";

/**
 * Component and version writes, including the publish transaction.
 *
 * Spec: docs/02-data-model.md §2.1 · docs/04 Flow 3
 */

/** Identity checks run before any storage work — cheap, and they fail fast. */
export async function findBySlug(slug: string) {
  return prisma.component.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      name: true,
      type: true,
      ownerId: true,
      deletedAt: true,
      latestVersion: { select: { version: true } },
    },
  });
}

/**
 * Is this exact archive already published?
 *
 * `checksumSha256` is globally unique, so this is both a duplicate-spam guard
 * and the thing that makes a retried publish idempotent-ish: the second attempt
 * gets 409 rather than creating a twin component (docs/03 §3.7).
 */
export async function findVersionByChecksum(checksum: string) {
  return prisma.componentVersion.findUnique({
    where: { checksumSha256: checksum },
    select: { id: true, version: true, component: { select: { slug: true } } },
  });
}

/**
 * Everything the caller has published, including the items a public catalog
 * query would hide.
 *
 * Deliberately NOT filtered by `status` or `deletedAt`: this is the owner's own
 * dashboard, and a component that has been suspended or deleted is exactly what
 * they need to see and be told about. Every OTHER read path filters both
 * (rules/40).
 */
export async function listByOwner(ownerId: string) {
  return prisma.component.findMany({
    where: { ownerId },
    select: {
      id: true,
      slug: true,
      displayName: true,
      type: true,
      summary: true,
      status: true,
      downloadCount: true,
      deletedAt: true,
      updatedAt: true,
      latestVersion: { select: { version: true, createdAt: true } },
      _count: { select: { versions: true } },
      tags: { select: { tag: { select: { slug: true, label: true } } } },
    },
    orderBy: { updatedAt: "desc" },
  });
}

export interface NewComponentInput {
  slug: string;
  name: string;
  displayName: string;
  type: DbComponentType;
  summary: string;
  readme: string | null;
  license: string;
  homepage: string | null;
  repository: string | null;
  ownerId: string;
}

export interface NewVersionInput {
  version: string;
  /** The validated manifest. Converted to Prisma's JSON type below, not here. */
  manifest: ComponentManifest;
  objectKey: string;
  sizeBytes: number;
  checksumSha256: string;
  changelog: string | null;
  publishedById: string;
}

export interface PublishResult {
  slug: string;
  version: string;
  checksumSha256: string;
}

/**
 * Create a component and its first version in ONE transaction.
 *
 * Everything here must succeed or fail together (rules/40). A `Component` with
 * no version is invisible and unpublishable; a version with no
 * `latestVersionId` pointer makes the catalog show "no version"; a missing
 * `PUBLISHER` promotion locks the author out of their own next release.
 *
 * There is deliberately NO storage call inside. The `CopyObject` happens before
 * this opens — holding a transaction across network I/O is how connection pools
 * die, and an orphaned object is harmless where a dangling row is a 404
 * (non-negotiable #7).
 */
export async function createComponentWithVersion(
  component: NewComponentInput,
  version: NewVersionInput,
  tagSlugs: readonly string[],
): Promise<PublishResult> {
  return prisma.$transaction(async (tx) => {
    const created = await tx.component.create({
      data: { ...component, status: "PUBLISHED" },
      select: { id: true, slug: true },
    });

    const createdVersion = await tx.componentVersion.create({
      data: { ...version, manifest: toJson(version.manifest), componentId: created.id },
      select: { id: true, version: true, checksumSha256: true },
    });

    await tx.component.update({
      where: { id: created.id },
      data: { latestVersionId: createdVersion.id },
    });

    await attachTags(tx, created.id, tagSlugs);

    // First publish earns the PUBLISHER role. Scoped to USER so an ADMIN is
    // never silently demoted by publishing something.
    await tx.user.updateMany({
      where: { id: component.ownerId, role: "USER" },
      data: { role: "PUBLISHER" },
    });

    await tx.auditLog.create({
      data: {
        actorId: component.ownerId,
        action: "COMPONENT_PUBLISHED",
        targetType: "Component",
        targetId: created.id,
        metadata: { slug: created.slug, version: createdVersion.version },
      },
    });

    return {
      slug: created.slug,
      version: createdVersion.version,
      checksumSha256: createdVersion.checksumSha256,
    };
  });
}

export interface VersionUpdateInput {
  summary: string;
  readme: string | null;
  license: string;
  homepage: string | null;
  repository: string | null;
}

/**
 * Add a new version to an existing component, in one transaction.
 *
 * The component's descriptive fields refresh from the new archive (docs/03
 * §3.8) — but `name` and `type` never move, and are not even accepted here.
 */
export async function addVersionToComponent(
  componentId: string,
  version: NewVersionInput,
  refresh: VersionUpdateInput,
  tagSlugs: readonly string[],
): Promise<PublishResult> {
  return prisma.$transaction(async (tx) => {
    const createdVersion = await tx.componentVersion.create({
      data: { ...version, manifest: toJson(version.manifest), componentId },
      select: { id: true, version: true, checksumSha256: true },
    });

    const updated = await tx.component.update({
      where: { id: componentId },
      data: { ...refresh, latestVersionId: createdVersion.id },
      select: { slug: true, ownerId: true },
    });

    await attachTags(tx, componentId, tagSlugs);

    await tx.auditLog.create({
      data: {
        actorId: version.publishedById,
        action: "COMPONENT_VERSION_PUBLISHED",
        targetType: "Component",
        targetId: componentId,
        metadata: { slug: updated.slug, version: createdVersion.version },
      },
    });

    return {
      slug: updated.slug,
      version: createdVersion.version,
      checksumSha256: createdVersion.checksumSha256,
    };
  });
}

/**
 * Convert a validated manifest to Prisma's JSON input type.
 *
 * `InputJsonValue` cannot express `Record<string, unknown>` — which the manifest
 * legitimately contains (`configSchema`, `inputSchema`) — even though the value
 * is plainly JSON. Round-tripping is what makes the assertion true rather than a
 * claim, and it lives HERE so no service has to import a Prisma type (docs/01 §4).
 */
function toJson(manifest: ComponentManifest): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(manifest)) as Prisma.InputJsonValue;
}

/**
 * Upsert the tags and link them, replacing whatever was linked before.
 *
 * `Tag` rows are shared across components, so `upsert` rather than `create` —
 * two components publishing with "pdf" on the same day must not collide.
 */
async function attachTags(
  tx: Prisma.TransactionClient,
  componentId: string,
  tagSlugs: readonly string[],
): Promise<void> {
  if (tagSlugs.length === 0) return;

  for (const slug of tagSlugs) {
    const tag = await tx.tag.upsert({
      where: { slug },
      update: {},
      // A readable fallback label: "data-extraction" → "Data extraction".
      create: {
        slug,
        label: slug.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()),
      },
      select: { id: true },
    });

    await tx.componentTag.upsert({
      where: { componentId_tagId: { componentId, tagId: tag.id } },
      update: {},
      create: { componentId, tagId: tag.id },
    });
  }
}
