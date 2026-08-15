import { requireAuth } from "@/server/auth/guards";
import { listMine } from "@/server/services/component.service";
import { jsonOk, withRoute } from "@/lib/http";

/**
 * GET /api/me/components 🔒 — everything the caller has published.
 *
 * Spec: docs/03-api-contract.md §3.13
 */

// Per-user and reflects a publish that may have happened seconds ago.
export const dynamic = "force-dynamic";

export const GET = withRoute(async (_req, { requestId }) => {
  const user = await requireAuth();
  return jsonOk(await listMine(user.id), requestId);
});
