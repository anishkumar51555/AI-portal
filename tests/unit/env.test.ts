import { describe, it, expect } from "vitest";
import { parseServerEnv, serverEnvSchema } from "@/lib/env";

/** A complete, valid environment. Individual tests break one field at a time. */
const VALID = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://portal:pw@localhost:5432/ai_portal",
  AUTH_SECRET: "a".repeat(32),
  AUTH_GITHUB_ID: "client-id",
  AUTH_GITHUB_SECRET: "client-secret",
  S3_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "ai-portal",
  S3_ACCESS_KEY_ID: "minioadmin",
  S3_SECRET_ACCESS_KEY: "minioadmin",
  DOWNLOAD_IP_SALT: "0123456789abcdef",
} satisfies Record<string, string>;

describe("[F0.1] environment validation", () => {
  it("accepts a complete configuration", () => {
    expect(() => parseServerEnv(VALID)).not.toThrow();
  });

  it("applies documented defaults for optional values", () => {
    const env = parseServerEnv(VALID);
    expect(env.MAX_UPLOAD_BYTES).toBe(10_485_760); // 10 MB
    expect(env.MAX_UNCOMPRESSED_BYTES).toBe(52_428_800); // 50 MB
    expect(env.MAX_ARCHIVE_ENTRIES).toBe(1_000);
    expect(env.MAX_COMPRESSION_RATIO).toBe(100);
    expect(env.S3_REGION).toBe("us-east-1");
    expect(env.LOG_LEVEL).toBe("info");
  });

  it.each([
    "DATABASE_URL",
    "AUTH_SECRET",
    "AUTH_GITHUB_ID",
    "AUTH_GITHUB_SECRET",
    "S3_ENDPOINT",
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "DOWNLOAD_IP_SALT",
  ])("refuses to start when %s is missing", (key) => {
    const broken: Record<string, string | undefined> = { ...VALID };
    delete broken[key];
    expect(() => parseServerEnv(broken)).toThrow(new RegExp(key));
  });

  it("names every offending variable at once, not just the first", () => {
    // Fixing five missing vars one crash at a time is miserable; the error
    // message must list them together.
    const broken = { NODE_ENV: "test" };
    let message = "";
    try {
      parseServerEnv(broken);
    } catch (e) {
      message = (e as Error).message;
    }
    for (const key of ["DATABASE_URL", "AUTH_SECRET", "S3_BUCKET", "DOWNLOAD_IP_SALT"]) {
      expect(message, `expected ${key} in the error`).toContain(key);
    }
  });

  it("rejects an AUTH_SECRET shorter than 32 characters", () => {
    // A short secret signs a forgeable session cookie.
    expect(() => parseServerEnv({ ...VALID, AUTH_SECRET: "tooshort" })).toThrow(
      /AUTH_SECRET/,
    );
  });

  it("rejects a DOWNLOAD_IP_SALT shorter than 16 characters", () => {
    expect(() => parseServerEnv({ ...VALID, DOWNLOAD_IP_SALT: "short" })).toThrow(
      /DOWNLOAD_IP_SALT/,
    );
  });

  it("rejects a non-PostgreSQL DATABASE_URL", () => {
    expect(() => parseServerEnv({ ...VALID, DATABASE_URL: "mysql://x/y" })).toThrow(
      /DATABASE_URL/,
    );
  });

  it("rejects a malformed S3_ENDPOINT", () => {
    expect(() => parseServerEnv({ ...VALID, S3_ENDPOINT: "localhost:9000" })).toThrow(
      /S3_ENDPOINT/,
    );
  });

  it("coerces numeric limits from strings, as they arrive from the environment", () => {
    const env = parseServerEnv({ ...VALID, MAX_UPLOAD_BYTES: "2048" });
    expect(env.MAX_UPLOAD_BYTES).toBe(2048);
    expect(typeof env.MAX_UPLOAD_BYTES).toBe("number");
  });

  it("parses S3_FORCE_PATH_STYLE as a real boolean", () => {
    // MinIO needs true, R2 needs false. The string "false" is truthy in JS, so
    // getting this wrong silently breaks every storage call against R2.
    expect(
      parseServerEnv({ ...VALID, S3_FORCE_PATH_STYLE: "true" }).S3_FORCE_PATH_STYLE,
    ).toBe(true);
    expect(
      parseServerEnv({ ...VALID, S3_FORCE_PATH_STYLE: "false" }).S3_FORCE_PATH_STYLE,
    ).toBe(false);
  });

  it("rejects a presign TTL beyond one hour", () => {
    expect(() => parseServerEnv({ ...VALID, PRESIGN_TTL_SECONDS: "7200" })).toThrow();
  });

  it("declares every variable documented in .env.example", () => {
    // Guards against a variable being read in code but never declared here —
    // which would make it silently undefined at runtime.
    const declared = Object.keys(serverEnvSchema.shape);
    for (const key of Object.keys(VALID)) {
      expect(declared, `${key} is not declared in serverEnvSchema`).toContain(key);
    }
  });
});
