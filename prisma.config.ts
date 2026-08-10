import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// `import "dotenv/config"` loads .env and NOTHING else. Next.js loads
// .env.local, but the Prisma CLI runs outside Next — so without this the
// migration would fail with "DATABASE_URL is not set" even though the app
// starts fine. Earlier entries win, so .env.local overrides .env.
loadEnv({ path: [".env.local", ".env"], quiet: true });

/**
 * Prisma CLI configuration (Prisma 7+).
 *
 * In Prisma 6 and earlier the connection string lived in the `datasource` block
 * of schema.prisma. Prisma 7 moved it here, and made the runtime client take an
 * explicit driver adapter — see src/server/db.ts.
 *
 * This file configures the CLI only: migrate, db pull, studio, seed. The
 * application never reads it.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",

  datasource: {
    // Migrations need a DIRECT (unpooled) connection — PgBouncer in transaction
    // mode cannot run DDL reliably. Locally both are the same container; in
    // production DATABASE_URL is Neon's pooled host and DIRECT_DATABASE_URL is not.
    // docs/05 section 3.1
    url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? "",
  },

  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});
