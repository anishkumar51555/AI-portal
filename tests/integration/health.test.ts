import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { closeTestDb, databaseAvailable, storageAvailable } from "./_helpers";

/**
 * Health endpoint, exercised against real dependencies.
 *
 * The route handler is imported and called directly with a Request — no HTTP
 * server needed. That keeps the test fast while still running the real handler,
 * the real service, the real repository, and the real Postgres/MinIO clients.
 *
 * Spec: docs/03-api-contract.md section 3.1
 * Features: F0.2, F0.3
 */

let dbUp = false;
let storageUp = false;

beforeAll(async () => {
  dbUp = await databaseAvailable();
  storageUp = await storageAvailable();
  if (!dbUp || !storageUp) {
    console.warn(
      `\n  ⚠ Integration dependencies unavailable (db=${dbUp}, storage=${storageUp}).` +
        `\n    Run: npm run docker:up\n`,
    );
  }
});

afterAll(async () => {
  await closeTestDb();
});

describe("[F0.2] GET /api/health — shallow", () => {
  it("reports liveness without touching any dependency", async () => {
    // Deliberately NOT gated on dbUp: the shallow check must answer even when
    // the database is down. That is the entire distinction from the deep check —
    // a container whose database died is alive but not ready, and restarting it
    // would not help.
    const { GET } = await import("@/app/api/health/route");
    const res = await GET(new Request("http://localhost:3000/api/health"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("commit");
    expect(typeof body.uptimeSec).toBe("number");
    expect(body).not.toHaveProperty("checks");
  });

  it("is never cached", async () => {
    // A cached health check reports the past. Worse than having none.
    const { GET } = await import("@/app/api/health/route");
    const res = await GET(new Request("http://localhost:3000/api/health"));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("carries a request id for log correlation", async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = await GET(
      new Request("http://localhost:3000/api/health", {
        headers: { "X-Request-Id": "test-req-abc" },
      }),
    );
    // An upstream id is reused rather than replaced, so one trace spans hops.
    expect(res.headers.get("X-Request-Id")).toBe("test-req-abc");
  });
});

describe("[F0.3] GET /api/health?deep=1 — dependency checks", () => {
  it("reports database and storage status with real latencies", async (ctx) => {
    // ctx.skip(), not `return`. An early return reports as PASSED, which is a
    // lie the moment someone reads the summary and concludes this was verified.
    // In CI databaseAvailable() throws instead, so this can never skip there.
    if (!dbUp || !storageUp) ctx.skip();

    const { GET } = await import("@/app/api/health/route");
    const res = await GET(new Request("http://localhost:3000/api/health?deep=1"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      checks: {
        database: { status: string; latencyMs: number };
        storage: { status: string };
      };
    };

    expect(body.status).toBe("ok");
    expect(body.checks.database.status).toBe("ok");
    expect(body.checks.storage.status).toBe("ok");
    // A real query was made, so latency is measured, not fabricated.
    expect(body.checks.database.latencyMs).toBeGreaterThanOrEqual(0);
    expect(body.checks.database.latencyMs).toBeLessThan(5_000);
  });

  it("accepts deep=true as well as deep=1", async (ctx) => {
    if (!dbUp || !storageUp) ctx.skip();
    const { GET } = await import("@/app/api/health/route");
    const res = await GET(new Request("http://localhost:3000/api/health?deep=true"));
    expect((await res.json()) as { checks?: unknown }).toHaveProperty("checks");
  });

  // The degraded → 503 mapping is pure logic over the two ping results, so it
  // is unit-tested with mocked pings in tests/unit/health.service.test.ts.
  // Trying to force a real dependency down from here does not work: the storage
  // client is a module singleton built from env at import time, so mutating
  // process.env afterwards changes nothing and the assertion would silently
  // test the happy path instead.
});
