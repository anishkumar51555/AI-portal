import { NextResponse, type NextRequest } from "next/server";
import { ulid } from "ulid";

/**
 * ⚠️  THIS IS NOT A SECURITY BOUNDARY.  ⚠️
 *
 * It does three things, none of which is authorization:
 *   1. Attaches a request id so one request's log lines can be correlated.
 *   2. Redirects a visitor with no session cookie away from an authed page,
 *      so they see a login screen instead of an error. Pure UX.
 *   3. Sets the Content-Security-Policy, which needs the STORAGE ORIGIN — a
 *      runtime value. `next.config.ts` headers are fixed at build time, so a
 *      CSP written there would be wrong the moment MinIO becomes R2.
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

/**
 * The browser talks DIRECTLY to object storage — that is the whole point of the
 * presigned upload and the 302 download — so the storage origin must be in
 * `connect-src` or every upload dies with an opaque CSP violation (F5.3).
 *
 * Read from the env at request time. `S3_PUBLIC_ENDPOINT` is the browser-facing
 * address, which differs from the app's internal one whenever they are on
 * separate networks (localhost:9000 vs minio:9000 in Docker).
 */
function storageOrigin(): string {
  const raw = process.env.S3_PUBLIC_ENDPOINT ?? process.env.S3_ENDPOINT ?? "";
  try {
    return raw === "" ? "" : new URL(raw).origin;
  } catch {
    // A malformed endpoint must not take the whole site down with a thrown
    // middleware; a missing connect-src source only breaks uploads.
    return "";
  }
}

function contentSecurityPolicy(): string {
  const storage = storageOrigin();
  const isDev = process.env.NODE_ENV === "development";

  return [
    "default-src 'self'",
    // Next injects inline bootstrap scripts; 'unsafe-eval' is required by the
    // dev-mode React refresh runtime ONLY, and is absent in production.
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    // Tailwind and next/font emit inline styles.
    "style-src 'self' 'unsafe-inline'",
    // GitHub avatars, plus data: for inlined icons.
    "img-src 'self' data: https://avatars.githubusercontent.com",
    "font-src 'self' data:",
    `connect-src 'self'${storage === "" ? "" : ` ${storage}`}`,
    `form-action 'self'${storage === "" ? "" : ` ${storage}`}`,
    // Nothing here is ever framed, and nothing frames anything.
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; ");
}

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
  res.headers.set("Content-Security-Policy", contentSecurityPolicy());
  return res;
}

export const config = {
  // Skip static assets and image optimization — running middleware on every
  // .css and .png request is pure latency for no benefit.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
