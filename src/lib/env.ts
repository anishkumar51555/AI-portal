import { z } from "zod";

/**
 * Boot-time environment validation.
 *
 * A missing AUTH_SECRET should crash the process in ~50ms with a message naming
 * the variable — not produce a mysterious 500 three days later. Everything the
 * app reads from the environment is declared here and nowhere else.
 *
 * Spec: docs/05-infrastructure.md section 2.3
 * Feature: F0.1
 */

/**
 * A URL that is genuinely http(s).
 *
 * `z.url()` alone is not enough: the WHATWG parser reads "localhost:9000" as
 * scheme `localhost:` with path `9000` and accepts it. That is exactly the typo
 * someone makes when omitting `http://`, and it would sail through validation
 * only to fail with an opaque error on the first storage call.
 */
const httpUrl = z.url().refine(
  (value) => {
    try {
      const { protocol } = new URL(value);
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  },
  { message: "Must be an http:// or https:// URL" },
);

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // ── database ──
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((v) => v.startsWith("postgresql://") || v.startsWith("postgres://"), {
      message: "Must be a PostgreSQL connection string (postgresql://…)",
    }),

  // ── Auth.js ──
  // 32 bytes minimum: AUTH_SECRET signs the session JWT. A short secret is a
  // forgeable session.
  AUTH_SECRET: z.string().min(32, "Must be at least 32 characters — run: npx auth secret"),
  AUTH_GITHUB_ID: z.string().min(1),
  AUTH_GITHUB_SECRET: z.string().min(1),
  AUTH_TRUST_HOST: z.stringbool().default(true),

  // ── object storage ──
  S3_ENDPOINT: httpUrl,
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  // MinIO needs path-style addressing; R2 and AWS S3 do not. Wrong value here
  // produces 403s and DNS errors on every storage call.
  S3_FORCE_PATH_STYLE: z.stringbool().default(false),
  // What the BROWSER should hit for presigned URLs. Differs from S3_ENDPOINT
  // when the server reaches storage over an internal network name.
  S3_PUBLIC_ENDPOINT: httpUrl.optional(),

  // ── upload limits (docs/08 section 4) ──
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10_485_760),
  MAX_UNCOMPRESSED_BYTES: z.coerce.number().int().positive().default(52_428_800),
  MAX_ARCHIVE_ENTRIES: z.coerce.number().int().positive().default(1_000),
  MAX_COMPRESSION_RATIO: z.coerce.number().int().positive().default(100),
  PRESIGN_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(900),
  DOWNLOAD_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(300),

  // ── privacy / ops ──
  // Raw IPs are never stored; downloads record sha256(ip + salt).
  DOWNLOAD_IP_SALT: z
    .string()
    .min(16, "Must be at least 16 characters — run: openssl rand -hex 16"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
});

/** Only NEXT_PUBLIC_* may ever reach the browser bundle. */
export const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: httpUrl,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type ClientEnv = z.infer<typeof clientEnvSchema>;

/**
 * Pure parse — takes the raw record so tests can exercise it without touching
 * process.env. On failure throws with every offending variable listed at once,
 * because fixing five missing vars one crash at a time is miserable.
 */
export function parseServerEnv(raw: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(raw);
  if (result.success) return result.data;

  const lines = result.error.issues.map(
    (i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`,
  );
  throw new Error(
    `Invalid environment configuration:\n${lines.join("\n")}\n\n` +
      `Copy .env.example to .env.local and fill in the blanks. ` +
      `See docs/05-infrastructure.md section 2.3.`,
  );
}

export function parseClientEnv(raw: Record<string, string | undefined>): ClientEnv {
  const result = clientEnvSchema.safeParse(raw);
  if (result.success) return result.data;
  const lines = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
  throw new Error(`Invalid public environment configuration:\n${lines.join("\n")}`);
}

/**
 * The server singleton.
 *
 * Importing this from a Client Component is a bug — it would bundle secrets into
 * browser JavaScript. The guard turns that into a loud, self-explaining failure
 * instead of a silent leak.
 */
function loadServerEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new Error(
      "src/lib/env.ts was imported into client code. It holds server secrets and " +
        "must never reach the browser bundle. Use clientEnv (NEXT_PUBLIC_* only), " +
        "or pass the value down as a prop from a Server Component.",
    );
  }
  return parseServerEnv(process.env);
}

export const env: ServerEnv = loadServerEnv();

export const clientEnv: ClientEnv = parseClientEnv({
  // Must be referenced statically — Next inlines NEXT_PUBLIC_* at build time by
  // literal text match, so `process.env[name]` would not be replaced.
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});
