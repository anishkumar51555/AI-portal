import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  AppError,
  ERROR_STATUS,
  formatIssuePath,
  toFieldErrors,
  validationError,
} from "@/domain/errors";
import { toResponse } from "@/lib/http";

describe("[F0.4] error taxonomy and envelope", () => {
  it("maps every code to the status documented in docs/03 section 1.2", () => {
    // Locking these down: a status drift is an API contract break that no
    // type-check would catch.
    expect(ERROR_STATUS.UNAUTHENTICATED).toBe(401);
    expect(ERROR_STATUS.FORBIDDEN).toBe(403);
    expect(ERROR_STATUS.STAGING_FORBIDDEN).toBe(403);
    expect(ERROR_STATUS.NOT_FOUND).toBe(404);
    expect(ERROR_STATUS.STAGING_NOT_FOUND).toBe(404);
    expect(ERROR_STATUS.VALIDATION_ERROR).toBe(400);
    expect(ERROR_STATUS.SLUG_TAKEN).toBe(409);
    expect(ERROR_STATUS.VERSION_EXISTS).toBe(409);
    expect(ERROR_STATUS.VERSION_NOT_INCREASING).toBe(409);
    expect(ERROR_STATUS.DUPLICATE_ARCHIVE).toBe(409);
    expect(ERROR_STATUS.MANIFEST_MISSING).toBe(422);
    expect(ERROR_STATUS.MANIFEST_INVALID).toBe(422);
    expect(ERROR_STATUS.ARCHIVE_INVALID).toBe(422);
    expect(ERROR_STATUS.ARCHIVE_UNSAFE).toBe(422);
    expect(ERROR_STATUS.ARCHIVE_TOO_LARGE).toBe(413);
    expect(ERROR_STATUS.RATE_LIMITED).toBe(429);
    expect(ERROR_STATUS.INTERNAL_ERROR).toBe(500);
  });

  it("distinguishes 400 (unparseable) from 422 (parsed but wrong)", () => {
    // Small distinction, and the one reviewers check first.
    expect(ERROR_STATUS.VALIDATION_ERROR).toBe(400);
    expect(ERROR_STATUS.MANIFEST_INVALID).toBe(422);
  });

  it("derives status from code so a call site cannot pair them wrongly", () => {
    expect(new AppError("SLUG_TAKEN").status).toBe(409);
    expect(new AppError("RATE_LIMITED").status).toBe(429);
  });

  it("carries a safe default message for every code", () => {
    for (const code of Object.keys(ERROR_STATUS) as Array<keyof typeof ERROR_STATUS>) {
      const message = new AppError(code).message;
      expect(message.length, `${code} has no default message`).toBeGreaterThan(0);
      // Defaults are written for the publisher, not the developer.
      expect(message).not.toMatch(/undefined|\[object|Error:/);
    }
  });

  describe("field-error paths", () => {
    it("renders nested array paths in bracket form the UI can address", () => {
      // tools[0].name — NOT tools,0,name. The bracket form is what lets the
      // upload wizard highlight the exact input.
      expect(formatIssuePath(["tools", 0, "name"])).toBe("tools[0].name");
      expect(formatIssuePath(["runtime", "language"])).toBe("runtime.language");
      expect(formatIssuePath(["version"])).toBe("version");
      expect(formatIssuePath([])).toBe("(root)");
      expect(formatIssuePath(["a", 0, 1, "b"])).toBe("a[0][1].b");
    });

    it("converts a real ZodError into addressable details", () => {
      const schema = z.object({
        version: z.string(),
        tools: z.array(z.object({ name: z.string() })),
      });
      const result = schema.safeParse({ tools: [{}] });
      expect(result.success).toBe(false);

      const details = toFieldErrors(result.error!);
      const paths = details.map((d) => d.path);
      expect(paths).toContain("version");
      expect(paths).toContain("tools[0].name");
    });
  });

  it("validationError attaches details and the requested code", () => {
    const result = z.object({ a: z.string() }).safeParse({});
    const err = validationError(result.error!, "MANIFEST_INVALID");
    expect(err.code).toBe("MANIFEST_INVALID");
    expect(err.status).toBe(422);
    expect(err.details).toHaveLength(1);
  });
});

describe("[F0.5] error responses never leak internals", () => {
  async function body(res: Response) {
    return (await res.json()) as {
      error: { code: string; message: string; details?: unknown[] };
      requestId: string;
    };
  }

  it("returns the documented envelope for an AppError", async () => {
    const res = toResponse(new AppError("SLUG_TAKEN"), "req-1");
    expect(res.status).toBe(409);
    expect(res.headers.get("X-Request-Id")).toBe("req-1");

    const json = await body(res);
    expect(json.error.code).toBe("SLUG_TAKEN");
    expect(json.requestId).toBe("req-1");
  });

  it("includes details[] when present, omits the key when not", async () => {
    const withDetails = await body(
      toResponse(
        new AppError("MANIFEST_INVALID", undefined, {
          details: [{ path: "version", message: "Must be valid semver" }],
        }),
        "req-2",
      ),
    );
    expect(withDetails.error.details).toHaveLength(1);

    const without = await body(toResponse(new AppError("NOT_FOUND"), "req-3"));
    expect(without.error).not.toHaveProperty("details");
  });

  it("never exposes a stack trace, file path, SQL, or exception message on a 500", async () => {
    const leaky = new Error(
      "Connection to postgresql://portal:hunter2@10.0.0.5:5432 failed at " +
        'E:\\AI Portal\\src\\server\\db.ts:42 — SELECT * FROM "User" WHERE id = $1',
    );
    const res = toResponse(leaky, "req-4");
    expect(res.status).toBe(500);

    const raw = JSON.stringify(await body(res));
    for (const secret of [
      "postgresql://",
      "hunter2",
      "10.0.0.5",
      "src\\\\server\\\\db.ts",
      "SELECT",
      "stack",
    ]) {
      expect(raw, `leaked: ${secret}`).not.toContain(secret);
    }
    // The user still gets something actionable to quote.
    expect(raw).toContain("req-4");
  });

  it("does not serialize AppError.context, which is for logs only", async () => {
    const res = toResponse(
      new AppError("STAGING_FORBIDDEN", undefined, {
        context: { stagingKey: "staging/victim-user-id/secret.zip" },
      }),
      "req-5",
    );
    const raw = JSON.stringify(await body(res));
    expect(raw).not.toContain("victim-user-id");
  });

  it("treats a leaked ZodError as a 400, not a crash", async () => {
    const result = z.object({ a: z.string() }).safeParse({});
    const res = toResponse(result.error, "req-6");
    expect(res.status).toBe(400);
    expect((await body(res)).error.code).toBe("VALIDATION_ERROR");
  });
});
