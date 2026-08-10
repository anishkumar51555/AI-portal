import { handlers } from "@/server/auth/config";

/**
 * Auth.js catch-all route: sign-in, sign-out, OAuth callback, CSRF, session.
 *
 * All of it is handled by the library — see docs/04-sequence-flows.md Flow 1 for
 * what actually happens across these requests, including the `state` parameter
 * and PKCE verification that make the callback safe.
 */
export const { GET, POST } = handlers;
