import { AppError } from "@/domain/errors";
import { toUrlType, type DbComponentType } from "@/domain/schemas/manifest";
import type { TemplateSummary } from "@/domain/schemas/template";
import {
  findTemplateByType,
  listTemplates,
  recordTemplateDownload,
  type TemplateRow,
} from "@/server/repositories/template.repository";
import { getSignedDownloadUrl } from "@/server/storage/storage.service";

/**
 * Template catalog: listing and gated downloads.
 *
 * Spec: docs/03-api-contract.md §3.2–3.3, docs/04 Flow 2
 * Features: F2.12
 */

function toSummary(row: TemplateRow): TemplateSummary {
  const urlType = toUrlType(row.type);
  return {
    type: row.type,
    urlType,
    name: row.name,
    description: row.description,
    version: row.version,
    sizeBytes: row.sizeBytes,
    checksumSha256: row.checksumSha256,
    downloadCount: row.downloadCount,
    // Deep-links into the manifest spec section for this type.
    docsUrl: row.docsUrl ?? `/docs/templates#${urlType}`,
    downloadUrl: `/api/templates/${urlType}/download`,
  };
}

/** Public — the catalog is visible to logged-out visitors; only the download is gated. */
export async function list(): Promise<TemplateSummary[]> {
  const rows = await listTemplates();
  return rows.map(toSummary);
}

export interface DownloadContext {
  userId: string;
  ipHash: string | null;
  userAgent: string | null;
}

/**
 * Authorize, count, then presign.
 *
 * The order matters. The counter is written BEFORE the URL is signed so a
 * download cannot be handed out un-counted; the reverse order would lose the
 * record whenever the transaction failed after the user already had a working
 * URL. Counting a download the user then abandons is the cheaper error.
 *
 * The presign itself is deliberately outside the transaction — it is network
 * I/O, and holding a database transaction open across a network call is how
 * connection pools get exhausted (rules/40).
 */
export async function getDownloadUrl(
  type: DbComponentType,
  context: DownloadContext,
): Promise<string> {
  const template = await findTemplateByType(type);
  if (!template) {
    throw new AppError("NOT_FOUND", "That template does not exist.");
  }

  await recordTemplateDownload({
    templateId: template.id,
    userId: context.userId,
    ipHash: context.ipHash,
    userAgent: context.userAgent,
  });

  // Filename the user sees: mcp-gateway-template-1.0.0.zip
  return getSignedDownloadUrl(
    template.objectKey,
    `${toUrlType(template.type)}-template`,
    template.version,
  );
}
