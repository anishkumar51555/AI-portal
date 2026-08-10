import { NextResponse } from "next/server";
import { ulid } from "ulid";
import { ZodError } from "zod";
import { AppError, toFieldErrors, type ErrorCode, type FieldError } from "@/domain/errors";
import { logger } from "./logger";

/**
 * The single place HTTP responses are shaped.
 *
 * Route handlers never build an error response themselves — they throw AppError
 * and let this format it, so the envelope in docs/03 section 1.1 is identical on
 * every endpoint.
 */

export const REQUEST_ID_HEADER = "X-Request-Id";

/** Reuse an upstream/middleware id when present so one trace spans the request. */
export function getRequestId(req?: Request): string {
  return req?.headers.get(REQUEST_ID_HEADER) ?? ulid();
}

interface ErrorBody {
  error: { code: ErrorCode; message: string; details?: FieldError[] };
  requestId: string;
}

export function jsonOk<T>(data: T, requestId: string, status = 200): NextResponse {
  return NextResponse.json(
    { data },
    { status, headers: { [REQUEST_ID_HEADER]: requestId } },
  );
}

export function noContent(requestId: string): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: { [REQUEST_ID_HEADER]: requestId },
  });
}

/**
 * 302 to a presigned storage URL.
 *
 * `no-store` is load-bearing: a cached redirect would hand the next user a stale,
 * already-expired signature (docs/04 Flow 2).
 */
export function redirectToSignedUrl(url: string, requestId: string): NextResponse {
  return new NextResponse(null, {
    status: 302,
    headers: { Location: url, "Cache-Control": "no-store", [REQUEST_ID_HEADER]: requestId },
  });
}

/**
 * Convert any thrown value into the documented error envelope.
 *
 * The 500 branch is the important one: it logs everything and returns nothing.
 * A response body must never carry a stack trace, SQL fragment, file path, or
 * exception message (docs/12 section 4, feature F0.5). The user gets a requestId
 * they can quote; the detail stays in the logs.
 */
export function toResponse(err: unknown, requestId: string): NextResponse {
  // A ZodError that escaped a handler is a validation failure, not a crash.
  if (err instanceof ZodError) {
    return errorResponse("VALIDATION_ERROR", undefined, toFieldErrors(err), requestId);
  }

  if (AppError.is(err)) {
    const level = err.status >= 500 ? "error" : "warn";
    logger[level](
      { requestId, code: err.code, status: err.status, context: err.context },
      "handled error",
    );
    return errorResponse(err.code, err.message, err.details, requestId, err.status);
  }

  logger.error({ requestId, err }, "unhandled error");
  return errorResponse("INTERNAL_ERROR", undefined, undefined, requestId);
}

function errorResponse(
  code: ErrorCode,
  message: string | undefined,
  details: FieldError[] | undefined,
  requestId: string,
  status?: number,
): NextResponse {
  const error = new AppError(code, message);
  const body: ErrorBody = {
    error: {
      code,
      message: message ?? error.message,
      ...(details?.length ? { details } : {}),
    },
    requestId,
  };
  return NextResponse.json(body, {
    status: status ?? error.status,
    headers: { [REQUEST_ID_HEADER]: requestId },
  });
}

/**
 * Wrap a route handler so it always has a requestId and always routes errors
 * through `toResponse`. Removes the try/catch boilerplate from every handler —
 * and, more importantly, removes the chance of forgetting it.
 *
 *   export const GET = withRoute(async (req, { requestId }) => {
 *     const user = await requireAuth();
 *     return jsonOk(await service.list(), requestId);
 *   });
 */
export function withRoute<Ctx = unknown>(
  handler: (req: Request, meta: { requestId: string; ctx: Ctx }) => Promise<NextResponse>,
) {
  return async (req: Request, ctx: Ctx): Promise<NextResponse> => {
    const requestId = getRequestId(req);
    try {
      return await handler(req, { requestId, ctx });
    } catch (err) {
      return toResponse(err, requestId);
    }
  };
}
