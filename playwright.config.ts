import { defineConfig, devices } from "@playwright/test";

/**
 * Two journeys only — see docs/11-testing-strategy.md §4.
 * E2E has the highest maintenance cost per test; two well-chosen ones beat
 * twenty flaky ones.
 *
 * Auth is injected via a seeded session cookie (storageState), never by
 * driving the real GitHub OAuth screen. Automating GitHub's login page is
 * slow, rate-limited, and tests GitHub rather than this application.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["html"], ["github"]] : [["list"]],
  timeout: 30_000,
  expect: { timeout: 7_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  // Reuse an already-running dev server locally; start one in CI.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
