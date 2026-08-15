import { toUrlType } from "@/domain/schemas/manifest";
import { listByOwner } from "@/server/repositories/component.repository";

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
