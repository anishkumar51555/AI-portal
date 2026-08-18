import type { CatalogCriteria, CatalogPage } from "@/domain/schemas/catalog";
import { toUrlType } from "@/domain/schemas/manifest";
import { AppError } from "@/domain/errors";
import type { ComponentPatch } from "@/domain/schemas/component-edit";
import {
  findBySlug,
  findDetailBySlug,
  findVersionForDownload,
  listByOwner,
  recordComponentDownload,
  search as searchComponents,
  setSuspended,
  softDeleteComponent,
  updateComponent,
} from "@/server/repositories/component.repository";
import { getSignedDownloadUrl } from "@/server/storage/storage.service";

/**
 * Component reads for the owner's dashboard.
 *
 * Catalog search lands in Phase 4; this covers only "what have I published".
 *
 * Spec: docs/03-api-contract.md §3.13
 */

export interface MyComponent {
  slug: string;
  displayName: string;
  type: string;
  urlType: string;
  summary: string;
  status: string;
  latestVersion: string | null;
  versionCount: number;
  downloadCount: number;
  tags: Array<{ slug: string; label: string }>;
  isDeleted: boolean;
  updatedAt: string;
}

export async function listMine(userId: string): Promise<MyComponent[]> {
  const rows = await listByOwner(userId);

  return rows.map((row) => ({
    slug: row.slug,
    displayName: row.displayName,
    type: row.type,
    urlType: toUrlType(row.type),
    summary: row.summary,
    status: row.status,
    latestVersion: row.latestVersion?.version ?? null,
    versionCount: row._count.versions,
    downloadCount: row.downloadCount,
    tags: row.tags.map((t) => t.tag),
    // Surfaced rather than hidden: an owner whose component was removed should
    // be told, not left wondering where it went.
    isDeleted: row.deletedAt !== null,
    updatedAt: row.updatedAt.toISOString(),
  }));
}

// ─────────────────────────── catalog search ───────────────────────────

export async function search(criteria: CatalogCriteria): Promise<CatalogPage> {
  const result = await searchComponents(criteria);

  return {
    data: result.rows.map((row) => ({
      slug: row.slug,
      displayName: row.displayName,
      type: row.type,
      urlType: toUrlType(row.type),
      summary: row.summary,
      latestVersion: row.latestVersion,
      downloadCount: row.downloadCount,
      tags: row.tags,
      owner: { githubLogin: row.ownerLogin, image: row.ownerImage },
      updatedAt: row.updatedAt.toISOString(),
    })),
    pagination: {
      page: criteria.page,
      pageSize: criteria.pageSize,
      total: result.total,
      // Ceil, and never below 1: "Page 1 of 0" on an empty catalog reads like a
      // bug even though the arithmetic is correct.
      totalPages: Math.max(1, Math.ceil(result.total / criteria.pageSize)),
    },
    facets: {
      types: result.types.map((t) => ({
        type: t.type,
        urlType: toUrlType(t.type),
        count: t.count,
      })),
      tags: result.tags,
    },
  };
}

// ─────────────────────────── detail ───────────────────────────

export interface ComponentDetail {
  slug: string;
  name: string;
  displayName: string;
  type: string;
  urlType: string;
  summary: string;
  /** RAW markdown. Sanitization happens once, at render (docs/03 §3.5). */
  readme: string | null;
  status: string;
  license: string;
  homepage: string | null;
  repository: string | null;
  downloadCount: number;
  tags: Array<{ slug: string; label: string }>;
  owner: { githubLogin: string | null; name: string | null; image: string | null };
  latestVersion: {
    version: string;
    sizeBytes: number;
    checksumSha256: string;
    manifest: unknown;
    changelog: string | null;
    createdAt: string;
    downloadUrl: string;
  } | null;
  versions: Array<{ version: string; sizeBytes: number; createdAt: string }>;
  versionCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * One component by slug, or null when the caller may not see it.
 *
 * Returns NULL rather than throwing a 403 for a suspended or deleted
 * component. The caller turns that into a 404, which is the point: a 403 would
 * confirm the slug exists and turn the endpoint into an enumeration oracle
 * (rules/50). "Hidden" and "never existed" must be indistinguishable.
 */
export async function getBySlug(
  slug: string,
  viewer: { role: string } | null,
): Promise<ComponentDetail | null> {
  const row = await findDetailBySlug(slug);
  if (!row) return null;

  const isAdmin = viewer?.role === "ADMIN";
  if (!isAdmin && (row.deletedAt !== null || row.status === "SUSPENDED")) return null;

  return {
    slug: row.slug,
    name: row.name,
    displayName: row.displayName,
    type: row.type,
    urlType: toUrlType(row.type),
    summary: row.summary,
    readme: row.readme,
    status: row.status,
    license: row.license,
    homepage: row.homepage,
    repository: row.repository,
    downloadCount: row.downloadCount,
    tags: row.tags.map((t) => t.tag),
    owner: row.owner,
    latestVersion: row.latestVersion
      ? {
          version: row.latestVersion.version,
          sizeBytes: row.latestVersion.sizeBytes,
          checksumSha256: row.latestVersion.checksumSha256,
          manifest: row.latestVersion.manifest,
          changelog: row.latestVersion.changelog,
          createdAt: row.latestVersion.createdAt.toISOString(),
          downloadUrl: `/api/components/${row.slug}/versions/${row.latestVersion.version}/download`,
        }
      : null,
    versions: row.versions.map((v) => ({
      version: v.version,
      sizeBytes: v.sizeBytes,
      createdAt: v.createdAt.toISOString(),
    })),
    versionCount: row._count.versions,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─────────────────────── version download ───────────────────────

export interface DownloadContext {
  userId: string;
  role: string;
  ipHash: string | null;
  userAgent: string | null;
}

/**
 * Authorize, count, then presign — the same order as the template download.
 *
 * The counter is written BEFORE the URL is signed so a download cannot be handed
 * out un-counted. This slightly OVER-counts: a user who aborts the transfer is
 * still counted. The correct fix is a storage access-log pipeline, which is
 * infrastructure this project deliberately does not build (docs/03 §3.9).
 */
export async function getVersionDownloadUrl(
  slug: string,
  version: string,
  context: DownloadContext,
): Promise<string> {
  const row = await findVersionForDownload(slug, version);

  // Every miss is the SAME 404: wrong slug, wrong version, suspended, deleted.
  // Distinguishing them would confirm which components exist (rules/50).
  const hidden =
    !row ||
    (context.role !== "ADMIN" &&
      (row.component.deletedAt !== null || row.component.status === "SUSPENDED"));

  if (hidden || !row) {
    throw new AppError("NOT_FOUND", "That version does not exist.");
  }

  await recordComponentDownload({
    componentId: row.component.id,
    versionId: row.id,
    userId: context.userId,
    ipHash: context.ipHash,
    userAgent: context.userAgent,
  });

  return getSignedDownloadUrl(row.objectKey, row.component.slug, row.version);
}

// ─────────────────────── edit / delete / suspend ───────────────────────

interface Actor {
  id: string;
  role: string;
}

/**
 * Load a component the actor is allowed to MUTATE, or throw 404.
 *
 * 404 and not 403 for someone else's component: a 403 confirms the slug exists
 * and turns this into an enumeration oracle (rules/50). An ADMIN passes for any
 * component.
 */
async function findMutable(slug: string, actor: Actor) {
  const component = await findBySlug(slug);

  const forbidden =
    !component ||
    component.deletedAt !== null ||
    (actor.role !== "ADMIN" && component.ownerId !== actor.id);

  if (forbidden || !component) {
    throw new AppError("NOT_FOUND", "That component does not exist.");
  }
  return component;
}

export async function patch(
  slug: string,
  actor: Actor,
  body: ComponentPatch,
): Promise<void> {
  const component = await findMutable(slug, actor);
  const { tags, ...fields } = body;

  await updateComponent(component.id, actor.id, fields, tags);
}

export async function softDelete(slug: string, actor: Actor): Promise<void> {
  const component = await findMutable(slug, actor);
  await softDeleteComponent(component.id, actor.id);
}

/**
 * Suspend or unsuspend. ADMIN only, enforced by the route's `requireFreshRole`.
 *
 * Unlike the owner paths this does NOT hide an already-suspended component from
 * the lookup — an admin must be able to unsuspend one.
 */
export async function suspend(
  slug: string,
  actor: Actor,
  suspended: boolean,
  reason: string | null,
): Promise<void> {
  const component = await findBySlug(slug);
  if (!component || component.deletedAt !== null) {
    throw new AppError("NOT_FOUND", "That component does not exist.");
  }

  await setSuspended(component.id, actor.id, suspended, reason);
}
