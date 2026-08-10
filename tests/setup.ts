/**
 * Vitest global setup. Imported once, before any test module.
 *
 * These assignments are at MODULE TOP LEVEL, not inside beforeAll, and that
 * matters: `src/lib/env.ts` validates and freezes configuration at import time,
 * exactly as it does in production. A `beforeAll` callback runs after test
 * modules are imported, so the env would not exist yet and every import of
 * env.ts would throw.
 *
 * Deliberately minimal — unit tests must not need a database, a network, or a
 * container. Integration tests override DATABASE_URL and the S3_* values with
 * real container endpoints in tests/integration/_helpers.ts.
 */

// Deterministic clock. NODE_ENV is not set here: Vitest already sets it to
// "test", and @types/node types it read-only.
process.env.TZ = "UTC";

const defaults: Record<string, string> = {
  DATABASE_URL:
    "postgresql://portal:portal_dev_password@localhost:5432/ai_portal_test?schema=public",
  AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long",
  AUTH_GITHUB_ID: "test-client-id",
  AUTH_GITHUB_SECRET: "test-client-secret",
  AUTH_TRUST_HOST: "true",
  S3_ENDPOINT: "http://localhost:9000",
  S3_REGION: "us-east-1",
  S3_BUCKET: "ai-portal-test",
  S3_ACCESS_KEY_ID: "minioadmin",
  S3_SECRET_ACCESS_KEY: "minioadmin",
  S3_FORCE_PATH_STYLE: "true",
  DOWNLOAD_IP_SALT: "test-salt-0123456789abcdef",
  LOG_LEVEL: "error", // keep test output readable
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
};

for (const [key, value] of Object.entries(defaults)) {
  process.env[key] ??= value;
}
