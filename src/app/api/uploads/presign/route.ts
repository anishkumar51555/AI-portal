import { AppError } from "@/domain/errors";
import { presignBodySchema } from "@/domain/schemas/upload";
import { requireAuth } from "@/server/auth/guards";
import { presignUpload } from "@/server/services/upload.service";
import { jsonOk, withRoute } from "@/lib/http";

/**
 * POST /api/uploads/presign 🔒 — step 1 of publishing.
 *
 * Spec: docs/03-api-contract.md §3.6
 * Features: F3.10, F3.11, F3.21
 */

// Mints a signed, expiring URL. Caching it would hand one user's staging slot
// to the next caller.
export const dynamic = "force-dynamic";

export const POST = withRoute(async (req, { requestId }) => {
  // Authorize before parsing: no reason to spend effort on a body from someone
  // who may not post one (rules/30).
  const user = await requireAuth();
  const body = presignBodySchema.parse(await readJson(req));

  const upload = await presignUpload(user.id, body);

  return jsonOk(
    {
      uploadUrl: upload.url,
      fields: upload.fields,
      stagingKey: upload.key,
      expiresAt: upload.expiresAt,
      maxSizeBytes: upload.maxSizeBytes,
    },
    requestId,
  );
});

/**
 * `req.json()` throws a bare `SyntaxError` on a malformed body, which would
 * fall through to the 500 branch. Unparseable input is a 400 — the client's
 * fault and worth telling them about (rules/30).
 */
async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch (err) {
    throw new AppError("VALIDATION_ERROR", "Request body is not valid JSON.", {
      cause: err,
    });
  }
}
