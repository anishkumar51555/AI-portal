import { AppError } from "@/domain/errors";
import { catalogQuerySchema, toCriteria } from "@/domain/schemas/catalog";
import { publishBodySchema } from "@/domain/schemas/publish";
import { getSessionUser, requireAuth } from "@/server/auth/guards";
import { search } from "@/server/services/component.service";
import { publishComponent } from "@/server/services/publish.service";
import { jsonOk, jsonPage, withRoute } from "@/lib/http";

/**
 * POST /api/components 🔒 — publish a new component.
 *
 * Four steps, as every handler has: authorize, validate, delegate, shape. All
 * the interesting work is in `publish.service` — a route that grew a pipeline
 * would be a route nobody could test without HTTP (rules/20).
 *
 * Spec: docs/03-api-contract.md §3.7 · docs/04 Flow 3
 * Features: F3.13–F3.17, F3.20
 */

export const dynamic = "force-dynamic";

/**
 * GET /api/components — catalog search.
 *
 * Public. The query schema coerces and clamps rather than throwing, so a stale
 * bookmark or a crawler hitting `?page=abc` gets page 1 instead of a 400
 * (rules/30).
 *
 * Spec: docs/03-api-contract.md §3.4
 * Features: F4.1–F4.5
 */
export const GET = withRoute(async (req, { requestId }) => {
  const params = new URL(req.url).searchParams;

  const query = catalogQuerySchema.parse({
    q: params.get("q") ?? undefined,
    // Repeatable: ?type=skill&type=agent
    type: params.getAll("type").length > 0 ? params.getAll("type") : undefined,
    tags: params.get("tags") ?? undefined,
    sort: params.get("sort") ?? undefined,
    page: params.get("page") ?? undefined,
    pageSize: params.get("pageSize") ?? undefined,
  });

  // Only an ADMIN sees SUSPENDED components. `getSessionUser` rather than
  // `requireAuth` — the catalog is public, the elevated view is not.
  const user = await getSessionUser();
  const page = await search(toCriteria(query, user?.role === "ADMIN"));

  return jsonPage(
    page.data,
    { pagination: page.pagination, facets: page.facets },
    requestId,
  );
});

export const POST = withRoute(async (req, { requestId }) => {
  const user = await requireAuth();
  const body = publishBodySchema.parse(await readJson(req));

  const result = await publishComponent(user, body, requestId);

  return jsonOk(
    {
      slug: result.slug,
      version: result.version,
      url: `/components/${result.slug}`,
      checksumSha256: result.checksumSha256,
    },
    requestId,
    201,
  );
});

/** A malformed body is a 400, not the 500 a bare SyntaxError would produce. */
async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch (err) {
    throw new AppError("VALIDATION_ERROR", "Request body is not valid JSON.", {
      cause: err,
    });
  }
}
