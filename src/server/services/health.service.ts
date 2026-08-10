import { pingDatabase } from "@/server/repositories/health.repository";
import { pingStorage } from "@/server/storage/client";

/**
 * Health reporting.
 *
 * Spec: docs/03-api-contract.md section 3.1
 * Features: F0.2, F0.3
 */

export interface ShallowHealth {
  status: "ok";
  version: string;
  commit: string;
  uptimeSec: number;
}

export interface DeepHealth extends Omit<ShallowHealth, "status"> {
  status: "ok" | "degraded";
  checks: {
    database: { status: "ok" | "down"; latencyMs: number };
    storage: { status: "ok" | "down"; latencyMs: number };
  };
}

const startedAt = Date.now();

export function shallowHealth(): ShallowHealth {
  return {
    status: "ok",
    version: process.env.npm_package_version ?? "0.0.0",
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
  };
}

export async function deepHealth(): Promise<DeepHealth> {
  // Probed in parallel: serially, a 2s database and a 2s storage check would
  // report as 4s and make one slow dependency look like two.
  const [database, storage] = await Promise.all([pingDatabase(), pingStorage()]);

  const healthy = database.ok && storage.ok;
  return {
    ...shallowHealth(),
    status: healthy ? "ok" : "degraded",
    checks: {
      database: { status: database.ok ? "ok" : "down", latencyMs: database.latencyMs },
      storage: { status: storage.ok ? "ok" : "down", latencyMs: storage.latencyMs },
    },
  };
}
