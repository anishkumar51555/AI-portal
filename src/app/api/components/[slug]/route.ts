import { AppError } from "@/domain/errors";
import { slugParamSchema } from "@/domain/schemas/catalog";
import { componentPatchSchema } from "@/domain/schemas/component-edit";
import { getSessionUser, requireAuth } from "@/server/auth/guards";
import { getBySlug, patch, softDelete } from "@/server/services/component.service";
import { jsonOk, noContent, withRoute } from "@/lib/http";

/**
 * GET /api/components/:slug — one component.
 *
 * Public. A suspended or soft-deleted component yields **404, not 403**: a 403
 * confirms the slug exists, which turns this into an enumeration oracle
 * (rules/50). Hidden and never-existed must look identical from outside.
 *
 * Spec: docs/03-api-contract.md §3.5
 * Features: F4.7
 */

export const dynamic = "force-dynamic";

export const GET = withRoute<{ params: Promise<{ slug: string }> }>(
  async (_req, { requestId, ctx }) => {
    const { slug } = slugParamSchema.parse(await ctx.params);

    const viewer = await getSessionUser();
    const component = await getBySlug(slug, viewer);

    if (!component) throw new AppError("NOT_FOUND", "That component does not exist.");

    return jsonOk(component, requestId);
  },
);

/**
 * PATCH /api/components/:slug 🔑 — owner or admin.
 *
 * Only `summary`, `homepage`, `repository`, `tags` and `status` are mutable.
 * `name`, `type`, `slug` and every version field are absent from the schema, so
 * `.strict()` turns an attempt at one into a 400 rather than a silent no-op —
 * silently ignoring it is worse, because the caller believes it worked.
 *
 * Spec: docs/03-api-contract.md §3.10
 * Features: F4.10
 */
export const PATCH = withRoute<{ params: Promise<{ slug: string }> }>(
  async (req, { requestId, ctx }) => {
    const user = await requireAuth();
    const { slug } = slugParamSchema.parse(await ctx.params);
    const body = componentPatchSchema.parse(await readJsonBody(req));

    await patch(slug, user, body);

    const updated = await getBySlug(slug, user);
    return jsonOk(updated, requestId);
  },
);

/**
 * DELETE /api/components/:slug 🔑 — soft delete, 204.
 *
 * Version rows and stored archives are retained (docs/02 §2.3): someone who
 * downloaded 1.2.0 must still be able to verify its checksum.
 *
 * Spec: docs/03-api-contract.md §3.11
 */
export const DELETE = withRoute<{ params: Promise<{ slug: string }> }>(
  async (_req, { requestId, ctx }) => {
    const user = await requireAuth();
    const { slug } = slugParamSchema.parse(await ctx.params);

    await softDelete(slug, user);

    return noContent(requestId);
  },
);

/** A malformed body is a 400, not the 500 a bare SyntaxError would produce. */
async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch (err) {
    throw new AppError("VALIDATION_ERROR", "Request body is not valid JSON.", {
      cause: err,
    });
  }
}
