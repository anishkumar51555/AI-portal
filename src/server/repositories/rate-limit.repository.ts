import { prisma } from "@/server/db";

/**
 * Fixed-window rate-limit counters.
 *
 * Spec: docs/03-api-contract.md §4
 */

/**
 * Increment the counter for a window and return the new value.
 *
 * One statement, so the read-modify-write cannot interleave: Postgres evaluates
 * `count + 1` while holding the row lock. Doing this as a `findUnique` followed
 * by an `update` would let two concurrent requests both read 9 and both write
 * 10, and the eleventh request through would be allowed.
 *
 * The remaining race is narrower and accepted: two requests can both INSERT the
 * first row for a window, and one loses with a unique-violation. The caller
 * retries once — see `rateLimit.service`.
 */
export async function incrementWindow(key: string, windowStart: Date): Promise<number> {
  const row = await prisma.rateLimit.upsert({
    where: { key_windowStart: { key, windowStart } },
    create: { key, windowStart, count: 1 },
    update: { count: { increment: 1 } },
    select: { count: true },
  });

  return row.count;
}

/** Current count without incrementing. For reporting headers on a rejected call. */
export async function readWindow(key: string, windowStart: Date): Promise<number> {
  const row = await prisma.rateLimit.findUnique({
    where: { key_windowStart: { key, windowStart } },
    select: { count: true },
  });

  return row?.count ?? 0;
}

/**
 * Delete windows that ended before `before`.
 *
 * Nothing calls this on the request path — it is for a scheduled sweep. Without
 * it the table grows one row per user per window forever, which is slow to
 * notice and annoying to fix later.
 */
export async function pruneWindowsBefore(before: Date): Promise<number> {
  const { count } = await prisma.rateLimit.deleteMany({
    where: { windowStart: { lt: before } },
  });

  return count;
}
