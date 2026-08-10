import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Integration test harness.
 *
 * These tests run against a REAL Postgres and a REAL MinIO — never a mock. A
 * mocked Prisma tests your mock, and storage semantics (presign conditions,
 * copy behaviour, key isolation) are exactly where the interesting bugs live.
 *
 * Local: `npm run docker:up` first.
 * CI:    service containers provide both (.github/workflows/ci.yml).
 */

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://portal:portal_dev_password@localhost:5432/ai_portal_test?schema=public";

export const testDb = new PrismaClient({
  adapter: new PrismaPg({ connectionString, max: 3, connectionTimeoutMillis: 3_000 }),
});

/**
 * Is the database actually reachable?
 *
 * In CI a missing database is a hard failure — the whole point of the
 * integration job is that the services are there. Locally it is a skip with a
 * readable reason, so a developer without Docker running is not blocked from
 * `npm run test`. Skipping quietly in CI would be the worst of both.
 */
export async function databaseAvailable(): Promise<boolean> {
  try {
    await testDb.$queryRaw`SELECT 1`;
    return true;
  } catch (err) {
    if (process.env.CI) {
      throw new Error(
        `Integration tests require PostgreSQL, and it is unreachable at ${redact(connectionString)}.\n` +
          `In CI this is a hard failure — the service container did not come up.\n` +
          `Cause: ${(err as Error).message}`,
      );
    }
    return false;
  }
}

export async function storageAvailable(): Promise<boolean> {
  const endpoint = process.env.S3_ENDPOINT ?? "http://localhost:9000";
  try {
    // MinIO's unauthenticated liveness endpoint — no credentials needed.
    const res = await fetch(`${endpoint}/minio/health/live`, {
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    if (process.env.CI) throw new Error(`Storage unreachable at ${endpoint} in CI.`);
    return false;
  }
}

/**
 * Truncate every table between tests.
 *
 * RESTART IDENTITY keeps sequences deterministic; CASCADE handles the foreign
 * keys. `_prisma_migrations` is excluded — wiping it would make Prisma think
 * the schema was never applied.
 */
export async function resetDatabase(): Promise<void> {
  const tables = await testDb.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename != '_prisma_migrations';
  `;
  if (tables.length === 0) return;

  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await testDb.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE;`);
}

/** A user to hang fixtures off. Defaults to USER — pass a role to override. */
export async function createTestUser(
  overrides: Partial<{
    email: string;
    githubLogin: string;
    role: "USER" | "PUBLISHER" | "ADMIN";
    name: string;
  }> = {},
) {
  const suffix = Math.random().toString(36).slice(2, 8);
  return testDb.user.create({
    data: {
      email: overrides.email ?? `test-${suffix}@example.com`,
      githubLogin: overrides.githubLogin ?? `test-${suffix}`,
      name: overrides.name ?? "Test User",
      role: overrides.role ?? "USER",
    },
  });
}

/** Never print credentials, not even in a test failure message. */
function redact(url: string): string {
  return url.replace(/\/\/([^:]+):([^@]+)@/, "//$1:***@");
}

export async function closeTestDb(): Promise<void> {
  await testDb.$disconnect();
}
