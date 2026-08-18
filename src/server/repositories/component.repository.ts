import { Prisma } from "@prisma/client";
import type { CatalogCriteria } from "@/domain/schemas/catalog";
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

/**
 * Everything the detail page shows, in one query.
 *
 * `include` rather than a follow-up query per relation: this is the N+1 shape
 * rules/40 warns about, and the detail page needs owner, tags, latest version
 * and a version count together or not at all.
 *
 * SUSPENDED and soft-deleted components are filtered by the CALLER, not here —
 * an ADMIN is allowed to see both, and burying that decision in the repository
 * would make the admin view impossible without a second query.
 */
export async function findDetailBySlug(slug: string) {
  return prisma.component.findUnique({
    where: { slug },
    select: {
      slug: true,
      name: true,
      displayName: true,
      type: true,
      summary: true,
      readme: true,
      status: true,
      license: true,
      homepage: true,
      repository: true,
      downloadCount: true,
      deletedAt: true,
      createdAt: true,
      updatedAt: true,
      owner: { select: { githubLogin: true, name: true, image: true } },
      tags: { select: { tag: { select: { slug: true, label: true } } } },
      latestVersion: {
        select: {
          version: true,
          sizeBytes: true,
          checksumSha256: true,
          manifest: true,
          changelog: true,
          createdAt: true,
        },
      },
      versions: {
        select: { version: true, createdAt: true, sizeBytes: true },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      _count: { select: { versions: true } },
    },
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
  const slugs = [...new Set(tagSlugs)];

  // REMOVE links that are no longer wanted, before adding the new ones.
  //
  // Without this the function only ever grew the tag set: republishing a
  // component with one tag removed left the old link in place forever, and
  // `tags: []` could not clear anything. Runs unconditionally — an empty
  // `slugs` deletes every link, which is exactly how tags get cleared.
  await tx.componentTag.deleteMany({
    where: {
      componentId,
      ...(slugs.length > 0 ? { tag: { slug: { notIn: slugs } } } : {}),
    },
  });

  for (const slug of slugs) {
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

// ─────────────────────────── catalog search ───────────────────────────

export interface CatalogRow {
  slug: string;
  displayName: string;
  type: DbComponentType;
  summary: string;
  latestVersion: string | null;
  downloadCount: number;
  tags: string[];
  ownerLogin: string | null;
  ownerImage: string | null;
  updatedAt: Date;
}

export interface TypeFacet {
  type: DbComponentType;
  count: number;
}
export interface TagFacet {
  slug: string;
  label: string;
  count: number;
}

export interface SearchResult {
  rows: CatalogRow[];
  total: number;
  types: TypeFacet[];
  tags: TagFacet[];
}

/**
 * Which filters to apply.
 *
 * A facet is counted with the same WHERE clause MINUS the facet being counted
 * (docs/03 §3.4). Otherwise filtering to "skill" would report `skill: 61` and
 * every other type as zero, so the sidebar could never be used to widen a
 * search — only ever to narrow it further.
 */
interface FilterOptions {
  omitTypeFilter?: boolean;
  omitTagFilter?: boolean;
}

function conditions(criteria: CatalogCriteria, options: FilterOptions = {}): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`c."deletedAt" IS NULL`];

  // SUSPENDED is invisible to everyone but an ADMIN (docs/03 §3.4).
  parts.push(
    criteria.includeSuspended
      ? Prisma.sql`c.status IN ('PUBLISHED', 'DEPRECATED', 'SUSPENDED')`
      : Prisma.sql`c.status IN ('PUBLISHED', 'DEPRECATED')`,
  );

  if (criteria.q) {
    // websearch_to_tsquery, never to_tsquery: it accepts natural syntax like
    // `pdf OR docx -legacy` and NEVER throws on malformed input. `to_tsquery`
    // raises a syntax error on a bare quote, which would turn a search box into
    // a 500 generator (docs/02 §4).
    parts.push(
      Prisma.sql`c."searchVector" @@ websearch_to_tsquery('english', ${criteria.q})`,
    );
  }

  if (!options.omitTypeFilter && criteria.types.length > 0) {
    // Compared as text so the driver never has to bind a Postgres enum array.
    parts.push(Prisma.sql`c.type::text = ANY(${criteria.types})`);
  }

  if (!options.omitTagFilter && criteria.tags.length > 0) {
    // AND semantics: the component must carry EVERY requested tag, so the
    // matched-tag count has to equal the number asked for.
    parts.push(Prisma.sql`(
      SELECT COUNT(DISTINCT t2.slug)
      FROM "ComponentTag" ct2
      JOIN "Tag" t2 ON t2.id = ct2."tagId"
      WHERE ct2."componentId" = c.id AND t2.slug = ANY(${criteria.tags})
    ) = ${criteria.tags.length}`);
  }

  return Prisma.join(parts, " AND ");
}

/** `ts_rank` when there is a query to rank against, otherwise a constant. */
function rankExpression(criteria: CatalogCriteria): Prisma.Sql {
  return criteria.q
    ? Prisma.sql`ts_rank(c."searchVector", websearch_to_tsquery('english', ${criteria.q}))`
    : Prisma.sql`0`;
}

function orderBy(criteria: CatalogCriteria): Prisma.Sql {
  // `c.id` is the final tiebreaker on EVERY ordering, and it is not decoration:
  // LIMIT/OFFSET over a non-deterministic sort can show the same row on two
  // pages and skip another entirely. Ties are common here — plenty of
  // components share a download count of 0 (F4.5).
  switch (criteria.sort) {
    case "downloads":
      return Prisma.sql`c."downloadCount" DESC, c.id ASC`;
    case "newest":
      return Prisma.sql`c."createdAt" DESC, c.id ASC`;
    case "updated":
      return Prisma.sql`c."updatedAt" DESC, c.id ASC`;
    case "name":
      return Prisma.sql`c."displayName" ASC, c.id ASC`;
    case "relevance":
    default:
      return Prisma.sql`rank DESC, c."downloadCount" DESC, c.id ASC`;
  }
}

/**
 * Catalog search: rows, total, and both facet sets.
 *
 * All four queries run in ONE transaction so the counts describe exactly the
 * rows returned. Run separately, a publish landing between them would produce a
 * total that disagrees with the page — subtle, intermittent, and very annoying
 * to reproduce.
 */
export async function search(criteria: CatalogCriteria): Promise<SearchResult> {
  const where = conditions(criteria);
  const rank = rankExpression(criteria);

  const rowsQuery = prisma.$queryRaw<
    Array<Omit<CatalogRow, "downloadCount"> & { downloadCount: number }>
  >`
    SELECT c.slug,
           c."displayName",
           c.type::text                AS type,
           c.summary,
           c."downloadCount",
           c."updatedAt",
           v.version                   AS "latestVersion",
           u."githubLogin"             AS "ownerLogin",
           u.image                     AS "ownerImage",
           COALESCE(
             ARRAY_AGG(DISTINCT t.slug) FILTER (WHERE t.slug IS NOT NULL),
             '{}'
           )                           AS tags,
           ${rank}                     AS rank
    FROM "Component" c
    LEFT JOIN "ComponentVersion" v ON v.id = c."latestVersionId"
    JOIN      "User" u             ON u.id = c."ownerId"
    LEFT JOIN "ComponentTag" ct    ON ct."componentId" = c.id
    LEFT JOIN "Tag" t              ON t.id = ct."tagId"
    WHERE ${where}
    GROUP BY c.id, v.version, u."githubLogin", u.image
    ORDER BY ${orderBy(criteria)}
    LIMIT ${criteria.pageSize} OFFSET ${criteria.skip};
  `;

  const totalQuery = prisma.$queryRaw<Array<{ total: bigint }>>`
    SELECT COUNT(*)::bigint AS total FROM "Component" c WHERE ${where};
  `;

  const typeFacetQuery = prisma.$queryRaw<Array<{ type: DbComponentType; count: bigint }>>`
    SELECT c.type::text AS type, COUNT(*)::bigint AS count
    FROM "Component" c
    WHERE ${conditions(criteria, { omitTypeFilter: true })}
    GROUP BY c.type
    ORDER BY count DESC, type ASC;
  `;

  const tagFacetQuery = prisma.$queryRaw<
    Array<{ slug: string; label: string; count: bigint }>
  >`
    SELECT t.slug, t.label, COUNT(DISTINCT c.id)::bigint AS count
    FROM "Component" c
    JOIN "ComponentTag" ct ON ct."componentId" = c.id
    JOIN "Tag" t           ON t.id = ct."tagId"
    WHERE ${conditions(criteria, { omitTagFilter: true })}
    GROUP BY t.slug, t.label
    ORDER BY count DESC, t.slug ASC
    LIMIT 30;
  `;

  const [rows, total, types, tags] = await prisma.$transaction([
    rowsQuery,
    totalQuery,
    typeFacetQuery,
    tagFacetQuery,
  ]);

  return {
    rows: rows.map((row) => ({ ...row, downloadCount: Number(row.downloadCount) })),
    // COUNT() is int8, which the driver returns as BigInt — JSON.stringify
    // throws on those, so every count is narrowed here rather than at the edge.
    total: Number(total[0]?.total ?? 0),
    types: types.map((t) => ({ type: t.type, count: Number(t.count) })),
    tags: tags.map((t) => ({ slug: t.slug, label: t.label, count: Number(t.count) })),
  };
}

// ─────────────────────── version download ───────────────────────

/** One version, with just enough of its component to authorize the download. */
export async function findVersionForDownload(slug: string, version: string) {
  return prisma.componentVersion.findFirst({
    where: { version, component: { slug } },
    select: {
      id: true,
      version: true,
      objectKey: true,
      component: {
        select: { id: true, slug: true, status: true, deletedAt: true },
      },
    },
  });
}

export interface ComponentDownloadRecord {
  componentId: string;
  versionId: string;
  userId: string;
  ipHash: string | null;
  userAgent: string | null;
}

/**
 * Record one component download.
 *
 * One transaction, same reasoning as the template counter: a `Download` row
 * without the increment (or the reverse) leaves the analytics and the displayed
 * count permanently disagreeing, and nothing reconciles them.
 */
export async function recordComponentDownload(
  record: ComponentDownloadRecord,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.download.create({
      data: {
        kind: "COMPONENT",
        componentId: record.componentId,
        versionId: record.versionId,
        userId: record.userId,
        ipHash: record.ipHash,
        userAgent: record.userAgent,
      },
    });

    await tx.component.update({
      where: { id: record.componentId },
      data: { downloadCount: { increment: 1 } },
    });
  });
}

// ─────────────────────── edit / delete / suspend ───────────────────────

export interface ComponentPatchData {
  summary?: string;
  homepage?: string | null;
  repository?: string | null;
  status?: "PUBLISHED" | "DEPRECATED";
}

/** Apply an owner edit, replacing tags only when they were supplied. */
export async function updateComponent(
  componentId: string,
  actorId: string,
  data: ComponentPatchData,
  tagSlugs: readonly string[] | undefined,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.component.update({ where: { id: componentId }, data });

    // `undefined` means "not supplied" and leaves tags alone; an empty array
    // means "remove them all". Conflating the two would make clearing tags
    // impossible.
    if (tagSlugs !== undefined) await attachTags(tx, componentId, tagSlugs);

    await tx.auditLog.create({
      data: {
        actorId,
        action: "COMPONENT_UPDATED",
        targetType: "Component",
        targetId: componentId,
        metadata: { fields: Object.keys(data), tagsChanged: tagSlugs !== undefined },
      },
    });
  });
}

/**
 * Soft delete.
 *
 * Sets `deletedAt` and nothing else. Version rows and stored archives are
 * retained: someone who downloaded 1.2.0 last week must still be able to verify
 * its checksum, and the audit trail has to survive the author's change of heart
 * (docs/02 §2.3).
 */
export async function softDeleteComponent(
  componentId: string,
  actorId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.component.update({
      where: { id: componentId },
      data: { deletedAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        actorId,
        action: "COMPONENT_DELETED",
        targetType: "Component",
        targetId: componentId,
      },
    });
  });
}

/** Admin suspend / unsuspend, always audited with a reason. */
export async function setSuspended(
  componentId: string,
  actorId: string,
  suspended: boolean,
  reason: string | null,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.component.update({
      where: { id: componentId },
      data: { status: suspended ? "SUSPENDED" : "PUBLISHED" },
    });

    await tx.auditLog.create({
      data: {
        actorId,
        action: "COMPONENT_SUSPENDED",
        targetType: "Component",
        targetId: componentId,
        metadata: { suspended, reason },
      },
    });
  });
}
