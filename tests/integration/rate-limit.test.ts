import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testDb, databaseAvailable, resetDatabase, closeTestDb } from "./_helpers";
import {
  consume,
  enforce,
  peek,
  rateLimitHeaders,
  windowStartFor,
  RATE_LIMITS,
  type RateLimitRule,
} from "@/server/services/rate-limit.service";
import { AppError } from "@/domain/errors";

/**
 * Rate limiting, against a real Postgres.
 *
 * The counter is an atomic UPDATE, so a mocked Prisma would test the mock and
 * miss the only interesting property — that concurrent increments do not lose
 * each other.
 *
 * Spec: docs/03-api-contract.md §4
 * Features: F3.21
 */

let available = false;

const rule: RateLimitRule = { scope: "test", limit: 3, windowSeconds: 60 };

beforeAll(async () => {
  available = await databaseAvailable();
}, 60_000);

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  if (available) await resetDatabase();
});

describe("window arithmetic", () => {
  it("aligns windows to the epoch, not to the first request", () => {
    // Aligning per-user would mint a distinct windowStart per caller per burst,
    // and the table would grow without bound.
    const a = windowStartFor(3600, new Date("2026-08-12T10:17:43.000Z"));
    const b = windowStartFor(3600, new Date("2026-08-12T10:59:59.999Z"));

    expect(a.toISOString()).toBe("2026-08-12T10:00:00.000Z");
    expect(b.toISOString()).toBe(a.toISOString());
  });

  it("rolls to a new window at the boundary", () => {
    const before = windowStartFor(3600, new Date("2026-08-12T10:59:59.999Z"));
    const after = windowStartFor(3600, new Date("2026-08-12T11:00:00.000Z"));

    expect(after.getTime() - before.getTime()).toBe(3_600_000);
  });
});

describe("[F3.21] consuming the allowance", () => {
  it("allows exactly `limit` requests and refuses the next", async (ctx) => {
    if (!available) return ctx.skip();

    for (let i = 1; i <= rule.limit; i += 1) {
      const v = await consume(rule, "usr_a");
      expect(v.allowed, `request ${i} should be allowed`).toBe(true);
      expect(v.remaining).toBe(rule.limit - i);
    }

    const overflow = await consume(rule, "usr_a");
    expect(overflow.allowed).toBe(false);
    expect(overflow.remaining).toBe(0);
  });

  it("counts each subject separately", async (ctx) => {
    if (!available) return ctx.skip();

    for (let i = 0; i < rule.limit; i += 1) await consume(rule, "usr_a");

    // One user exhausting their allowance must not affect anyone else.
    const other = await consume(rule, "usr_b");
    expect(other.allowed).toBe(true);
    expect(other.remaining).toBe(rule.limit - 1);
  });

  it("counts each scope separately", async (ctx) => {
    if (!available) return ctx.skip();

    for (let i = 0; i < rule.limit; i += 1) await consume(rule, "usr_a");

    const otherScope = await consume({ ...rule, scope: "other" }, "usr_a");
    expect(otherScope.allowed).toBe(true);
  });

  it("resets when the window rolls over", async (ctx) => {
    if (!available) return ctx.skip();

    const inWindow = new Date("2026-08-12T10:30:00.000Z");
    for (let i = 0; i < rule.limit; i += 1) await consume(rule, "usr_a", inWindow);
    expect((await consume(rule, "usr_a", inWindow)).allowed).toBe(false);

    const nextWindow = new Date("2026-08-12T10:31:00.000Z");
    expect((await consume(rule, "usr_a", nextWindow)).allowed).toBe(true);
  });

  it("does not lose increments when requests race", async (ctx) => {
    if (!available) return ctx.skip();

    // The whole reason the repository uses one atomic UPDATE. A read-then-write
    // would let two of these read the same value and write the same result,
    // quietly granting extra allowance.
    const parallel = 20;
    await Promise.all(
      Array.from({ length: parallel }, () => consume({ ...rule, limit: 100 }, "usr_race")),
    );

    const row = await testDb.rateLimit.findFirst({ where: { key: "test:usr_race" } });
    expect(row?.count).toBe(parallel);
  });

  it("peek reports the state without spending any allowance", async (ctx) => {
    if (!available) return ctx.skip();

    await consume(rule, "usr_a");
    const first = await peek(rule, "usr_a");
    const second = await peek(rule, "usr_a");

    expect(first.remaining).toBe(rule.limit - 1);
    expect(second.remaining).toBe(first.remaining);
  });
});

describe("[F3.21] enforce throws a well-formed 429", () => {
  it("carries Retry-After and the X-RateLimit-* headers", async (ctx) => {
    if (!available) return ctx.skip();

    for (let i = 0; i < rule.limit; i += 1) await enforce(rule, "usr_a");

    const err = await enforce(rule, "usr_a").catch((e: unknown) => e);

    expect(AppError.is(err)).toBe(true);
    const appError = err as AppError;
    expect(appError.code).toBe("RATE_LIMITED");
    expect(appError.status).toBe(429);

    // Without Retry-After a client has no basis for backing off and will
    // hammer the endpoint until the window rolls (docs/03 §4).
    const headers = appError.headers ?? {};
    expect(Number(headers["Retry-After"])).toBeGreaterThan(0);
    expect(headers["X-RateLimit-Limit"]).toBe(String(rule.limit));
    expect(headers["X-RateLimit-Remaining"]).toBe("0");
    expect(Number(headers["X-RateLimit-Reset"])).toBeGreaterThan(0);
  });

  it("never echoes the subject into the client-visible message", async (ctx) => {
    if (!available) return ctx.skip();

    for (let i = 0; i < rule.limit; i += 1) await enforce(rule, "usr_secret_id");
    const err = (await enforce(rule, "usr_secret_id").catch((e: unknown) => e)) as AppError;

    // The user id belongs in the log context, not in a message that may be
    // screenshotted into a bug report.
    expect(err.message).not.toContain("usr_secret_id");
    expect(err.context).toMatchObject({ subject: "usr_secret_id" });
  });

  it("describes the window in words a human can act on", async (ctx) => {
    if (!available) return ctx.skip();

    for (let i = 0; i < RATE_LIMITS.presign.limit; i += 1) {
      await enforce(RATE_LIMITS.presign, "usr_h");
    }
    const err = (await enforce(RATE_LIMITS.presign, "usr_h").catch(
      (e: unknown) => e,
    )) as AppError;

    expect(err.message).toContain("10");
    expect(err.message).toContain("hour");
  });
});

describe("header shape", () => {
  it("reports reset as unix seconds, which is what clients expect", () => {
    const resetAt = new Date("2026-08-12T11:00:00.000Z");
    const headers = rateLimitHeaders({
      allowed: true,
      limit: 10,
      remaining: 7,
      resetAt,
      retryAfterSeconds: 42,
    });

    expect(headers["X-RateLimit-Reset"]).toBe(String(resetAt.getTime() / 1000));
    expect(headers["X-RateLimit-Reset"]).not.toContain("T");
  });
});
