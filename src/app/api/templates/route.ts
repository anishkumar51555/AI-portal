import { jsonOk, withRoute } from "@/lib/http";
import { list } from "@/server/services/template.service";

/**
 * GET /api/templates — the four starter templates.
 *
 * Public. Discovery is the point of this endpoint: a visitor deciding whether
 * to sign up needs to see what they would get. Only the DOWNLOAD is gated
 * (docs/07 §5).
 *
 * Spec: docs/03-api-contract.md §3.2
 * Features: F2.12
 */
export const GET = withRoute(async (_req, { requestId }) => {
  return jsonOk(await list(), requestId);
});
