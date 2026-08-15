import { AppError } from "@/domain/errors";
import { publishBodySchema } from "@/domain/schemas/publish";
import { requireAuth } from "@/server/auth/guards";
import { publishComponent } from "@/server/services/publish.service";
import { jsonOk, withRoute } from "@/lib/http";

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
