import { NextResponse } from "next/server";
import { deepHealth, shallowHealth } from "@/server/services/health.service";
import { getRequestId, REQUEST_ID_HEADER } from "@/lib/http";

/**
 * GET /api/health         — shallow. Is the process alive?
 * GET /api/health?deep=1  — deep.    Can it actually serve traffic?
 *
 * The split matters to an orchestrator: a container that is running but cannot
 * reach its database should fail READINESS, not liveness — restarting it will
 * not fix the database. The container HEALTHCHECK uses the shallow form; CI
 * smoke tests and uptime monitors use the deep one.
 *
 * Spec: docs/03-api-contract.md section 3.1
 * Features: F0.2, F0.3
 */

// A cached health check is worse than no health check.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request): Promise<NextResponse> {
  const requestId = getRequestId(req);
  const headers = { [REQUEST_ID_HEADER]: requestId, "Cache-Control": "no-store" };

  const deep = new URL(req.url).searchParams.get("deep");
  if (deep !== "1" && deep !== "true") {
    return NextResponse.json(shallowHealth(), { status: 200, headers });
  }

  const report = await deepHealth();
  return NextResponse.json(report, {
    status: report.status === "ok" ? 200 : 503,
    headers,
  });
}
