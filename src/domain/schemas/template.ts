import { z } from "zod";
import { URL_TYPES, toDbType, type ManifestType } from "@/domain/schemas/manifest";

/**
 * Schemas for the template endpoints.
 *
 * Spec: docs/03-api-contract.md §3.2, §3.3
 */

/**
 * The `:type` route parameter.
 *
 * URLs carry kebab-case (`mcp-gateway`); the database and TypeScript enums use
 * SCREAMING_SNAKE (`MCP_GATEWAY`). The conversion happens HERE, at the edge, so
 * neither spelling ever leaks into the other's territory (rules/00 §"The four
 * types"). `.strict()` because an unexpected route param means a routing bug,
 * not something to silently ignore.
 */
export const templateParamsSchema = z
  .object({
    type: z.enum(URL_TYPES),
  })
  .strict();

export type TemplateParams = z.infer<typeof templateParamsSchema>;

/** Parse a raw route param bag into the database enum. */
export function parseTemplateType(params: unknown) {
  const { type } = templateParamsSchema.parse(params);
  return { urlType: type, dbType: toDbType(type) };
}

/** The public shape of one template in `GET /api/templates`. */
export interface TemplateSummary {
  type: string;
  urlType: ManifestType;
  name: string;
  description: string;
  version: string;
  sizeBytes: number;
  checksumSha256: string;
  downloadCount: number;
  docsUrl: string;
  downloadUrl: string;
}
