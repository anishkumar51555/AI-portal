import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The degraded-status mapping.
 *
 * Both dependency probes are mocked here on purpose: the interesting behaviour
 * is what the service DOES with a failing probe, not whether Postgres is up.
 * The real-dependency path is covered in tests/integration/health.test.ts.
 *
 * Feature: F0.3
 */

const pingDatabase = vi.fn();
const pingStorage = vi.fn();

vi.mock("@/server/repositories/health.repository", () => ({
  pingDatabase: () => pingDatabase(),
}));
vi.mock("@/server/storage/client", () => ({
  pingStorage: () => pingStorage(),
}));

const { deepHealth, shallowHealth } = await import("@/server/services/health.service");
const { GET } = await import("@/app/api/health/route");

const up = { ok: true, latencyMs: 3 };
const down = { ok: false, latencyMs: 3001 };

beforeEach(() => {
  pingDatabase.mockReset();
  pingStorage.mockReset();
});

describe("deep health status mapping", () => {
  it("is ok when both dependencies are up", async () => {
    pingDatabase.mockResolvedValue(up);
    pingStorage.mockResolvedValue(up);

    const report = await deepHealth();
    expect(report.status).toBe("ok");
    expect(report.checks.database.status).toBe("ok");
    expect(report.checks.storage.status).toBe("ok");
  });

  it.each([
    ["database down", down, up],
    ["storage down", up, down],
    ["both down", down, down],
  ])("is degraded when %s", async (_label, db, storage) => {
    pingDatabase.mockResolvedValue(db);
    pingStorage.mockResolvedValue(storage);

    const report = await deepHealth();
    expect(report.status).toBe("degraded");
  });

  it("probes dependencies in parallel, not serially", async () => {
    // Serially, two 200ms probes would report as ~400ms and make one slow
    // dependency look like two. Timing the pair proves they overlap.
    const slow = (ms: number) => async () => {
      await new Promise((r) => setTimeout(r, ms));
      return { ok: true, latencyMs: ms };
    };
    pingDatabase.mockImplementation(slow(150));
    pingStorage.mockImplementation(slow(150));

    const started = Date.now();
    await deepHealth();
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(280); // ~150 if parallel, ~300 if serial
  });

  it("never throws when a probe fails — a health check must always answer", async () => {
    pingDatabase.mockResolvedValue(down);
    pingStorage.mockResolvedValue(down);
    await expect(deepHealth()).resolves.toBeTruthy();
  });
});

describe("health route status codes", () => {
  it("returns 200 for a healthy deep check", async () => {
    pingDatabase.mockResolvedValue(up);
    pingStorage.mockResolvedValue(up);

    const res = await GET(new Request("http://localhost:3000/api/health?deep=1"));
    expect(res.status).toBe(200);
  });

  it("returns 503 — not 200, not 500 — when degraded", async () => {
    // 503 is what tells a load balancer to stop routing here. A 200 would keep
    // traffic coming to an instance that cannot serve it; a 500 would suggest
    // the health endpoint itself is broken.
    pingDatabase.mockResolvedValue(down);
    pingStorage.mockResolvedValue(up);

    const res = await GET(new Request("http://localhost:3000/api/health?deep=1"));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { status: string }).status).toBe("degraded");
  });

  it("shallow check stays 200 even when dependencies are down", async () => {
    // Liveness vs readiness: the process is fine, so restarting it would not
    // help. Only the deep check should fail.
    pingDatabase.mockResolvedValue(down);
    pingStorage.mockResolvedValue(down);

    const res = await GET(new Request("http://localhost:3000/api/health"));
    expect(res.status).toBe(200);
    expect(pingDatabase).not.toHaveBeenCalled();
  });

  it("shallow report carries no checks block", () => {
    expect(shallowHealth()).not.toHaveProperty("checks");
  });
});
