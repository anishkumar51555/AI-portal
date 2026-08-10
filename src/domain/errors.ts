import type { ZodError } from "zod";

/**
 * The closed error taxonomy. Every non-2xx response the API can produce uses one
 * of these codes — see docs/03-api-contract.md section 1.2.
 *
 * "Closed" means: do not invent a code at a call site. Adding one is a change to
 * the API contract, so add it here AND in docs/03 in the same commit.
 */
export const ERROR_STATUS = {
  // ── auth ──
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,

  // ── lookup ──
  NOT_FOUND: 404,
  STAGING_NOT_FOUND: 404,
  STAGING_FORBIDDEN: 403,

  // ── request shape ──
  VALIDATION_ERROR: 400,

  // ── conflicts with current state ──
  SLUG_TAKEN: 409,
  VERSION_EXISTS: 409,
  VERSION_NOT_INCREASING: 409,
  DUPLICATE_ARCHIVE: 409,

  // ── semantically invalid content (parsed fine, wrong meaning) ──
  MANIFEST_MISSING: 422,
  MANIFEST_INVALID: 422,
  ARCHIVE_INVALID: 422,
  ARCHIVE_UNSAFE: 422,

  // ── limits ──
  ARCHIVE_TOO_LARGE: 413,
  RATE_LIMITED: 429,

  // ── catch-all ──
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

/** One field-level problem, addressable by the UI. */
export interface FieldError {
  /** Dotted/bracket path: `tools[0].name`, not `tools,0,name`. */
  path: string;
  message: string;
}

/**
 * The only error type services throw. Route handlers never construct HTTP
 * responses for errors — they let this bubble to one shared handler
 * (`toResponse` in src/lib/http.ts), so the envelope is identical everywhere.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: FieldError[];
  /** Internal context for logs. NEVER serialized into a response. */
  readonly context?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message?: string,
    options?: {
      details?: FieldError[];
      context?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(message ?? DEFAULT_MESSAGES[code], { cause: options?.cause });
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = options?.details;
    this.context = options?.context;
  }

  static is(err: unknown): err is AppError {
    return err instanceof AppError;
  }
}

/**
 * Safe-to-display defaults. Every one of these is written for the publisher who
 * hit it, not for the developer who wrote it — no internals, no jargon.
 */
const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHENTICATED: "Sign in to continue.",
  FORBIDDEN: "You do not have permission to do that.",
  NOT_FOUND: "Not found.",
  STAGING_NOT_FOUND: "That upload has expired or does not exist. Upload the file again.",
  STAGING_FORBIDDEN: "That upload does not belong to you.",
  VALIDATION_ERROR: "The request was not valid.",
  SLUG_TAKEN: "A component with that name already exists.",
  VERSION_EXISTS: "That version has already been published.",
  VERSION_NOT_INCREASING: "The new version must be higher than the current latest version.",
  DUPLICATE_ARCHIVE: "This exact archive has already been published.",
  MANIFEST_MISSING: "No component.json was found at the root of the archive.",
  MANIFEST_INVALID: "component.json failed validation against spec v1.0.",
  ARCHIVE_INVALID: "The file could not be read as a zip archive.",
  ARCHIVE_UNSAFE: "The archive contains entries that are not safe to distribute.",
  ARCHIVE_TOO_LARGE: "The archive is larger than the allowed limit.",
  RATE_LIMITED: "Too many requests. Try again shortly.",
  INTERNAL_ERROR: "An unexpected error occurred.",
};

/**
 * Format a Zod issue path the way a form can consume it.
 *
 *   ["tools", 0, "name"]  →  "tools[0].name"
 *
 * The bracket form matters: it is what lets the upload wizard highlight the exact
 * offending input. `tools,0,name` (the result of a naive join) addresses nothing.
 */
export function formatIssuePath(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return "(root)";
  return path.reduce<string>((acc, seg) => {
    if (typeof seg === "number") return `${acc}[${seg}]`;
    return acc ? `${acc}.${String(seg)}` : String(seg);
  }, "");
}

/**
 * Turn a ZodError into the `details[]` array of the error envelope.
 *
 * `unrecognized_keys` needs unpacking. Zod reports all unknown keys of an object
 * as ONE issue at the PARENT's path with a `keys` array — so a stray
 * `author.twitter` arrives as `{ path: ["author"], keys: ["twitter"] }`. Passed
 * through naively, the wizard would highlight the whole author block and the
 * publisher would have to guess which key is wrong. Expanding it into one error
 * per key restores the property the whole schema exists for: the message names
 * the exact field.
 */
export function toFieldErrors(error: ZodError): FieldError[] {
  const out: FieldError[] = [];

  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      const parent = formatIssuePath(issue.path);
      for (const key of issue.keys) {
        out.push({
          path: parent === "(root)" ? key : `${parent}.${key}`,
          message: `Unrecognized field "${key}". Check for a typo — unknown keys are rejected.`,
        });
      }
      continue;
    }

    out.push({ path: formatIssuePath(issue.path), message: issue.message });
  }

  return out;
}

/** Convenience for the most common validation failure. */
export function validationError(error: ZodError, code: ErrorCode = "VALIDATION_ERROR") {
  return new AppError(code, undefined, { details: toFieldErrors(error) });
}
