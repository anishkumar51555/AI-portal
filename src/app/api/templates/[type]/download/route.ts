import { parseTemplateType } from "@/domain/schemas/template";
import { requireAuth } from "@/server/auth/guards";
import { getDownloadUrl } from "@/server/services/template.service";
import { redirectToSignedUrl, withRoute } from "@/lib/http";
import { getUserAgent, hashClientIp } from "@/lib/request-ip";

/**
 * GET /api/templates/:type/download 🔒 — 302 to a presigned GET.
 *
 * Redirecting rather than proxying means the archive bytes never pass through
 * the app server (docs/01 §5.1). `Cache-Control: no-store` on the redirect is
 * load-bearing: a cached 302 would hand the next user an expired signature.
 *
 * Spec: docs/03-api-contract.md §3.3, docs/04 Flow 2
 * Features: F2.12
 */

// A presigned URL is per-user and expires; caching this route would be a bug.
export const dynamic = "force-dynamic";

export const GET = withRoute<{ params: Promise<{ type: string }> }>(
  async (req, { requestId, ctx }) => {
    // Authorize BEFORE validating (rules/30): no reason to spend parsing effort
    // on a request from someone who may not make it.
    const user = await requireAuth();
    const { dbType } = parseTemplateType(await ctx.params);

    const url = await getDownloadUrl(dbType, {
      userId: user.id,
      // A raw IP never reaches the database — only a salted hash.
      ipHash: hashClientIp(req),
      userAgent: getUserAgent(req),
    });

    return redirectToSignedUrl(url, requestId);
  },
);
