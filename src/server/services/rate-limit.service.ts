import { AppError } from "@/domain/errors";
import { incrementWindow, readWindow } from "@/server/repositories/rate-limit.repository";

/**
 * Fixed-window rate limiting.
 *
 * The limits themselves are in docs/03 §4. This module owns two things: the
 * window arithmetic, and the headers every 429 must carry.
 *
 * HONEST LIMITATION, worth saying out loud rather than implying otherwise: this
 * is a fixed window, not a sliding one. A caller can spend the full allowance in
 * the last second of one window and again in the first second of the next,
 * briefly achieving double the nominal rate. For abuse damping on a publish
 * endpoint that is fine — the property that matters is that no one can flood
 * without bound. A sliding window or a token bucket in Redis is the upgrade if
 * it ever matters.
 *
 * Spec: docs/03-api-contract.md §4
 * Features: F3.21
 */

export interface RateLimitRule {
  /** Prefix identifying what is being limited, e.g. "presign". */
  scope: string;
  limit: number;
  windowSeconds: number;
}

/** docs/03 §4. Defined here so a limit is never invented at a call site. */
export const RATE_LIMITS = {
  presign: { scope: "presign", limit: 10, windowSeconds: 60 * 60 },
  publish: { scope: "publish", limit: 20, windowSeconds: 24 * 60 * 60 },
  download: { scope: "download", limit: 100, windowSeconds: 60 * 60 },
  catalog: { scope: "catalog", limit: 120, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

export interface RateLimitVerdict {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** When the current window ends. */
  resetAt: Date;
  retryAfterSeconds: number;
}

/**
 * Floor `now` to the start of its window.
 *
 * Windows are aligned to the epoch rather than to a user's first request, so
 * every caller in the same window shares a boundary. That keeps the row count
 * bounded — an unaligned window would mint a distinct `windowStart` per user
 * per burst.
 */
export function windowStartFor(windowSeconds: number, now = new Date()): Date {
  const ms = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

function verdict(rule: RateLimitRule, count: number, windowStart: Date): RateLimitVerdict {
  const resetAt = new Date(windowStart.getTime() + rule.windowSeconds * 1000);
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));

  return {
    allowed: count <= rule.limit,
    limit: rule.limit,
    remaining: Math.max(0, rule.limit - count),
    resetAt,
    retryAfterSeconds,
  };
}

/**
 * Count one request against `subject` and report whether it is allowed.
 *
 * Increment-then-check, deliberately. Checking first and incrementing after
 * leaves a window where two concurrent requests both see room and both proceed;
 * incrementing first means each request gets a distinct count, so exactly one
 * of them sees `limit + 1`.
 */
export async function consume(
  rule: RateLimitRule,
  subject: string,
  now = new Date(),
): Promise<RateLimitVerdict> {
  const windowStart = windowStartFor(rule.windowSeconds, now);
  const key = `${rule.scope}:${subject}`;

  let count: number;
  try {
    count = await incrementWindow(key, windowStart);
  } catch {
    // Two requests can race to INSERT the window's first row; the loser gets a
    // unique violation. The row now exists, so a single retry succeeds.
    count = await incrementWindow(key, windowStart);
  }

  return verdict(rule, count, windowStart);
}

/** Inspect without consuming. */
export async function peek(
  rule: RateLimitRule,
  subject: string,
  now = new Date(),
): Promise<RateLimitVerdict> {
  const windowStart = windowStartFor(rule.windowSeconds, now);
  const count = await readWindow(`${rule.scope}:${subject}`, windowStart);

  return verdict(rule, count, windowStart);
}

/** The `X-RateLimit-*` headers. Sent on success as well as on a 429. */
export function rateLimitHeaders(v: RateLimitVerdict): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(v.limit),
    "X-RateLimit-Remaining": String(v.remaining),
    // Unix seconds — the convention every client library expects.
    "X-RateLimit-Reset": String(Math.floor(v.resetAt.getTime() / 1000)),
  };
}

/**
 * Consume, and throw a fully-formed 429 if the caller is over.
 *
 * `Retry-After` is mandatory on a 429 (docs/03 §4): without it a client has no
 * basis for backing off and will hammer the endpoint until the window rolls.
 */
export async function enforce(
  rule: RateLimitRule,
  subject: string,
  now = new Date(),
): Promise<RateLimitVerdict> {
  const v = await consume(rule, subject, now);

  if (!v.allowed) {
    throw new AppError(
      "RATE_LIMITED",
      `Too many requests. You may make ${rule.limit} of these per ` +
        `${describeWindow(rule.windowSeconds)}. Try again in ${v.retryAfterSeconds}s.`,
      {
        headers: { "Retry-After": String(v.retryAfterSeconds), ...rateLimitHeaders(v) },
        context: { scope: rule.scope, subject },
      },
    );
  }

  return v;
}

function describeWindow(seconds: number): string {
  if (seconds % 86_400 === 0)
    return seconds === 86_400 ? "day" : `${seconds / 86_400} days`;
  if (seconds % 3_600 === 0) return seconds === 3_600 ? "hour" : `${seconds / 3_600} hours`;
  if (seconds % 60 === 0) return seconds === 60 ? "minute" : `${seconds / 60} minutes`;
  return `${seconds} seconds`;
}
