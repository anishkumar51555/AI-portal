import { AppError } from "@/domain/errors";
import { slugParamSchema } from "@/domain/schemas/catalog";
import { suspendBodySchema } from "@/domain/schemas/component-edit";
import { requireFreshRole } from "@/server/auth/guards";
import { suspend } from "@/server/services/component.service";
import { jsonOk, withRoute } from "@/lib/http";

/**
 * POST /api/admin/components/:slug/suspend 👑
 *
 * `requireFreshRole`, not `requireRole`: this is a destructive admin action, so
 * the role is re-read from the database rather than trusted from the JWT. A
 * token issued before a demotion stays cryptographically valid until it expires
 * (rules/50).
 *
 * Spec: docs/03-api-contract.md §3.12
 * Features: F4.11
 */

export const dynamic = "force-dynamic";

export const POST = withRoute<{ params: Promise<{ slug: string }> }>(
  async (req, { requestId, ctx }) => {
    const admin = await requireFreshRole("ADMIN");
    const { slug } = slugParamSchema.parse(await ctx.params);
    const body = suspendBodySchema.parse(await readJson(req));

    await suspend(slug, admin, body.suspended, body.reason ?? null);

    return jsonOk({ slug, suspended: body.suspended }, requestId);
  },
);

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch (err) {
    throw new AppError("VALIDATION_ERROR", "Request body is not valid JSON.", {
      cause: err,
    });
  }
}
