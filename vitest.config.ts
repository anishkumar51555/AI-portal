import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Coverage thresholds are deliberately uneven — see docs/11-testing-strategy.md section 1.
// High bars where a bug is expensive (the spec, the security boundary), nothing on UI.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@tests": fileURLToPath(new URL("./tests", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules/**", "tests/e2e/**", "templates/**"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 15_000,
    hookTimeout: 30_000,

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
