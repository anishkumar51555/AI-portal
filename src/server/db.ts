import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "@/lib/env";

/**
 * The single Prisma client for the whole application.
 *
 * Two things here are load-bearing:
 *
 * 1. THE SINGLETON. Serverless re-evaluates modules on cold start and Next's dev
 *    server re-evaluates on every hot reload. `new PrismaClient()` per
 *    evaluation exhausts the Postgres connection pool within minutes. Caching on
 *    globalThis survives both.
 *
 * 2. THE DRIVER ADAPTER. Prisma 7 no longer reads the connection string from
 *    schema.prisma — the client takes an explicit adapter. That makes the pool
 *    configurable, which matters on serverless where each instance should hold
 *    very few connections.
 *
 * This module is the ONLY place PrismaClient is constructed, and repositories
 * are the only layer allowed to import it (docs/01 section 4).
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
    // Serverless instances are numerous and short-lived; a large pool per
    // instance is how you exhaust the database's connection limit.
    max: env.NODE_ENV === "production" ? 5 : 10,
    connectionTimeoutMillis: 10_000,
  });

  return new PrismaClient({
    adapter,
    log:
      env.NODE_ENV === "development"
        ? [
            { level: "warn", emit: "stdout" },
            { level: "error", emit: "stdout" },
          ]
        : [{ level: "error", emit: "stdout" }],
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// The database liveness probe lives in
// src/server/repositories/health.repository.ts, not here — this module exports
// the client and nothing else, so "who is allowed to query" stays answerable.
