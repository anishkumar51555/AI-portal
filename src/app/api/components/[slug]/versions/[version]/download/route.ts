import { z } from "zod";
import { slugName, semver } from "@/domain/schemas/manifest";
import { requireAuth } from "@/server/auth/guards";
import { getVersionDownloadUrl } from "@/server/services/component.service";
import { RATE_LIMITS, enforce } from "@/server/services/rate-limit.service";
import { redirectToSignedUrl, withRoute } from "@/lib/http";
import { getUserAgent, hashClientIp } from "@/lib/request-ip";

/**
 * GET /api/components/:slug/versions/:version/download 🔒
 *
 * Redirects rather than proxying, so archive bytes never pass through the app
 * server. `Cache-Control: no-store` on the 302 is load-bearing: a cached
 * redirect would hand the next user an expired signature.
 *
 * Spec: docs/03-api-contract.md §3.9
 * Features: F4.9
 */

export const dynamic = "force-dynamic";

const paramsSchema = z.object({ slug: slugName, version: semver }).strict();

export const GET = withRoute<{ params: Promise<{ slug: string; version: string }> }>(
  async (req, { requestId, ctx }) => {
    const user = await requireAuth();
    const { slug, version } = paramsSchema.parse(await ctx.params);

    // Keyed on userId, applied after auth and before the work (rules/30).
    await enforce(RATE_LIMITS.download, user.id);

    const url = await getVersionDownloadUrl(slug, version, {
      userId: user.id,
      role: user.role,
      // A raw IP never reaches the database — only a salted hash.
      ipHash: hashClientIp(req),
      userAgent: getUserAgent(req),
    });

    return redirectToSignedUrl(url, requestId);
  },
);
