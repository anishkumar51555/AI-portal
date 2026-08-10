import { prisma } from "@/server/db";

/**
 * Database liveness probe.
 *
 * Lives in the repository layer because it touches Prisma, and repositories are
 * the only layer permitted to (docs/01 section 4). It looks trivial enough to
 * inline into the route — which is exactly the reasoning that erodes a boundary
 * one exception at a time.
 */
export async function pingDatabase(): Promise<{ ok: boolean; latencyMs: number }> {
  const started = performance.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch {
    // The caller reports "down"; the reason is not useful to a health consumer
    // and must not reach the response body.
    return { ok: false, latencyMs: Math.round(performance.now() - started) };
  }
}
