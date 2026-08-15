import { AppError } from "@/domain/errors";
import { publishVersionBodySchema } from "@/domain/schemas/publish";
import { requireAuth } from "@/server/auth/guards";
import { publishVersion } from "@/server/services/publish.service";
import { jsonOk, withRoute } from "@/lib/http";

/**
 * POST /api/components/:slug/versions 🔒 — publish a new version.
 *
 * Same pipeline as a new component, with the identity rules layered on:
 * `name` and `type` are immutable, and the version must sort strictly above the
 * current latest. Those checks live in the validator and the service, not here.
 *
 * Spec: docs/03-api-contract.md §3.8
 * Features: F3.18, F3.19
 */

export const dynamic = "force-dynamic";

export const POST = withRoute<{ params: Promise<{ slug: string }> }>(
  async (req, { requestId, ctx }) => {
    const user = await requireAuth();
    const { slug } = await ctx.params;
    const body = publishVersionBodySchema.parse(await readJson(req));

    const result = await publishVersion(user, slug, body, requestId);

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
