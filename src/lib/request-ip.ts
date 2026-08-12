import { createHash } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Client IP handling for download analytics.
 *
 * The rule this file exists to enforce: a raw IP address never reaches the
 * database (docs/02 §2.4). We want to be able to spot one address pulling ten
 * thousand archives, which needs a stable identifier — but not to hold personal
 * data to get it. A salted hash gives abuse detection without the liability.
 */

/**
 * Pull the client address out of the proxy headers.
 *
 * Vercel sets `x-forwarded-for`; most other proxies do too, appending as the
 * request is forwarded, so the FIRST entry is the original client. This value
 * is client-controllable in principle — which is fine here, because the only
 * thing it feeds is a rate/abuse signal, never an authorization decision.
 */
export function getClientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() ?? null;
}

/**
 * `sha256(ip + salt)`.
 *
 * The salt is what makes this non-reversible in practice: without it, the IPv4
 * space is only ~4 billion values and an attacker with the table could recover
 * every address with a few minutes of hashing.
 */
export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return createHash("sha256").update(`${ip}${env.DOWNLOAD_IP_SALT}`).digest("hex");
}

/** Convenience: read the address off a request and hash it in one step. */
export function hashClientIp(req: Request): string | null {
  return hashIp(getClientIp(req));
}

/** User-agent, truncated to the column width. Never used for authorization. */
export function getUserAgent(req: Request): string | null {
  return req.headers.get("user-agent")?.slice(0, 512) ?? null;
}
