import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
  "@tests": fileURLToPath(new URL("./tests", import.meta.url)),
};

const shared = {
  environment: "node" as const,
  globals: true,
  exclude: ["node_modules/**", "tests/e2e/**", "templates/**"],
  setupFiles: ["tests/setup.ts"],
  testTimeout: 15_000,
  hookTimeout: 30_000,
};

// Coverage thresholds are deliberately uneven — see docs/11-testing-strategy.md section 1.
// High bars where a bug is expensive (the spec, the security boundary), nothing on UI.
export default defineConfig({
  resolve: { alias },
  test: {
    ...shared,
    include: ["tests/**/*.test.{ts,tsx}"],

    /**
     * Unit and integration tests differ in one crucial way: integration tests
     * share ONE Postgres database and TRUNCATE it between tests. Vitest runs
     * test FILES in parallel by default, so two integration files would wipe
     * each other's rows mid-test — a race that only shows up once there is more
     * than one file resetting state, and then looks like a flaky assertion
     * ("expected [] to have length 4") rather than a concurrency bug.
     *
     * `fileParallelism: false` serialises the integration files only. Unit tests
     * touch nothing shared, so they stay parallel and fast.
     */
    projects: [
      {
        resolve: { alias },
        test: { ...shared, name: "unit", include: ["tests/unit/**/*.test.{ts,tsx}"] },
      },
      {
        resolve: { alias },
        test: {
          ...shared,
          name: "integration",
          include: ["tests/integration/**/*.test.{ts,tsx}"],
          fileParallelism: false,
        },
      },
    ],

    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      reportsDirectory: "coverage",
      include: ["src/domain/**", "src/server/**"],
      exclude: [
        "**/*.d.ts",
        "**/index.ts",
        "src/server/db.ts",
        "src/server/auth/config.ts",
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 65,
        statements: 70,

        // The specification. A bug here corrupts the catalog.
        "src/domain/schemas/**": {
          lines: 95,
          functions: 95,
          branches: 90,
          statements: 95,
        },

        // The security boundary. Every guard needs a test.
        "src/server/services/archive.inspector.ts": {
          lines: 95,
          functions: 95,
          branches: 90,
          statements: 95,
        },
      },
    },
  },
});
