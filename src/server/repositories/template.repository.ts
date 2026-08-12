import type { ComponentType } from "@prisma/client";
import { prisma } from "@/server/db";

/**
 * Template reads and the download counter.
 *
 * Spec: docs/02-data-model.md §2.5, docs/04 Flow 2
 */

/** Explicit select — never hand a whole row to a caller (rules/40). */
const TEMPLATE_FIELDS = {
  id: true,
  type: true,
  name: true,
  description: true,
  version: true,
  objectKey: true,
  sizeBytes: true,
  checksumSha256: true,
  docsUrl: true,
  downloadCount: true,
} as const;

export type TemplateRow = {
  id: string;
  type: ComponentType;
  name: string;
  description: string;
  version: string;
  objectKey: string;
  sizeBytes: number;
  checksumSha256: string;
  docsUrl: string | null;
  downloadCount: number;
};

/**
 * All four templates.
 *
 * Ordered by `type` so the grid never reshuffles between requests — an unordered
 * `findMany` returns whatever Postgres finds convenient, which changes as rows
 * are updated. There are exactly four rows, so no pagination.
 */
export async function listTemplates(): Promise<TemplateRow[]> {
  return prisma.template.findMany({
    select: TEMPLATE_FIELDS,
    orderBy: { type: "asc" },
  });
}

export async function findTemplateByType(type: ComponentType): Promise<TemplateRow | null> {
  return prisma.template.findUnique({
    where: { type },
    select: TEMPLATE_FIELDS,
  });
}

export interface DownloadRecord {
  templateId: string;
  userId: string;
  ipHash: string | null;
  userAgent: string | null;
}

/**
 * Record one template download.
 *
 * Both writes are in a single transaction: a `Download` row without the counter
 * increment (or the reverse) leaves the analytics and the displayed count
 * permanently disagreeing, and nothing would ever reconcile them.
 *
 * No network I/O inside — the presign happens after this returns (rules/40).
 */
export async function recordTemplateDownload(record: DownloadRecord): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.download.create({
      data: {
        kind: "TEMPLATE",
        templateId: record.templateId,
        userId: record.userId,
        ipHash: record.ipHash,
        userAgent: record.userAgent,
      },
    });

    await tx.template.update({
      where: { id: record.templateId },
      data: { downloadCount: { increment: 1 } },
    });
  });
}
