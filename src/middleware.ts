import { NextResponse, type NextRequest } from "next/server";
import { ulid } from "ulid";

/**
 * ⚠️  THIS IS NOT A SECURITY BOUNDARY.  ⚠️
 *
 * It does two things, neither of which is authorization:
 *   1. Attaches a request id so one request's log lines can be correlated.
 *   2. Redirects a visitor with no session cookie away from an authed page,
 *      so they see a login screen instead of an error. Pure UX.
 *
 * It checks that a cookie EXISTS. It does not verify the signature, the
 * expiry, or the role — doing so would require the crypto secret at the edge
 * and a database round trip, and it would still not help, because a direct
 * `fetch('/api/components', ...)` never passes through a page at all.
 *
 * Real authorization happens inside every Route Handler, Server Action, and
 * protected Server Component via requireAuth/requireRole/requireOwnership.
 * Treating this file as the boundary is the single most common Next.js App
 * Router vulnerability.
 *
 * Spec: docs/08-security-model.md section 2.3
 */

const PROTECTED_PREFIXES = ["/dashboard", "/publish", "/settings", "/admin"];

// Auth.js names the cookie differently over HTTPS (__Secure- prefix).
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

export function middleware(req: NextRequest): NextResponse {
  const requestId = req.headers.get("X-Request-Id") ?? ulid();
  const { pathname, search } = req.nextUrl;

  const needsSession = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (needsSession) {
    const hasCookie = SESSION_COOKIES.some((name) => req.cookies.has(name));
    if (!hasCookie) {
      const login = new URL("/login", req.url);
      // Send them back where they were trying to go after signing in.
      login.searchParams.set("callbackUrl", `${pathname}${search}`);
      return NextResponse.redirect(login);
    }
  }

  // Forward the id so handlers and logs share one correlation key.
  const headers = new Headers(req.headers);
  headers.set("X-Request-Id", requestId);

  const res = NextResponse.next({ request: { headers } });
  res.headers.set("X-Request-Id", requestId);
  return res;
}

export const config = {
  // Skip static assets and image optimization — running middleware on every
  // .css and .png request is pure latency for no benefit.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
