/**
 * THE FEATURE REGISTRY — single source of truth for what must be tested.
 *
 * Every feature this project ships has an ID here. Tests claim a feature by
 * putting its ID in square brackets in the describe/it title:
 *
 *     describe("[F3.2] archive inspector — decompression bombs", () => { ... });
 *
 * `npm run test:matrix` scans tests/ for those tags and reports which features
 * have tests and which do not. That report is the answer to "is this feature
 * actually validated?" — not a coverage percentage, which can be high while the
 * thing that matters is untested.
 *
 * Adding a feature: add the row here FIRST, then write the test, then build it.
 */

export type Phase = "P0" | "P1" | "P2" | "P3" | "P4" | "P5";
export type Level = "unit" | "integration" | "e2e" | "manual";

export interface Feature {
  /** Stable id. Never reuse or renumber. */
  id: string;
  phase: Phase;
  /** What the user or system can do, in one line. */
  title: string;
  /** Where the test must live to be meaningful. */
  level: Level;
  /** Spec section that defines correct behaviour. */
  spec: string;
  /**
   * `critical` features block a phase from being called done.
   * Everything else is desirable but not a gate.
   */
  critical: boolean;
}

export const FEATURES: Feature[] = [
  // ── P0 · Foundation ────────────────────────────────────────────────
  {
    id: "F0.1",
    phase: "P0",
    title: "Env vars are validated at boot; a missing one crashes the process",
    level: "unit",
    spec: "docs/05 §2.3",
    critical: true,
  },
  {
    id: "F0.2",
    phase: "P0",
    title: "Health endpoint reports liveness",
    level: "integration",
    spec: "docs/03 §3.1",
    critical: true,
  },
  {
    id: "F0.3",
    phase: "P0",
    title: "Deep health check reports database and storage status",
    level: "integration",
    spec: "docs/03 §3.1",
    critical: false,
  },
  {
    id: "F0.4",
    phase: "P0",
    title: "AppError maps to the documented error envelope",
    level: "unit",
    spec: "docs/03 §1.1",
    critical: true,
  },
  {
    id: "F0.5",
    phase: "P0",
    title: "A 500 response leaks no stack trace, SQL, or file path",
    level: "unit",
    spec: "docs/12 §4",
    critical: true,
  },

  // ── P1 · Auth & RBAC ───────────────────────────────────────────────
  {
    id: "F1.1",
    phase: "P1",
    title: "requireAuth rejects an unauthenticated caller with 401",
    level: "unit",
    spec: "docs/08 §2.2",
    critical: true,
  },
  {
    id: "F1.2",
    phase: "P1",
    title: "requireRole enforces the USER < PUBLISHER < ADMIN hierarchy",
    level: "unit",
    spec: "docs/08 §2.2",
    critical: true,
  },
  {
    id: "F1.3",
    phase: "P1",
    title: "requireOwnership returns 404 (not 403) for a non-owned resource",
    level: "unit",
    spec: "docs/08 §2.2",
    critical: true,
  },
  {
    id: "F1.4",
    phase: "P1",
    title: "ADMIN destructive operations re-read the role from the database",
    level: "integration",
    spec: "docs/08 §2.2",
    critical: true,
  },
  {
    id: "F1.5",
    phase: "P1",
    title: "Sign-in upserts a User and writes USER_SIGNED_IN to the audit log",
    level: "integration",
    spec: "docs/04 Flow 1",
    critical: false,
  },
  {
    id: "F1.6",
    phase: "P1",
    title: "Protected route redirects an anonymous visitor with a callbackUrl",
    level: "e2e",
    spec: "docs/04 Flow 1",
    critical: false,
  },
  {
    id: "F1.7",
    phase: "P1",
    // Was "manual" until it turned out Set-Cookie headers are trivially
    // assertable from Playwright. `Secure` stays production-only: it is
    // correctly absent over http://localhost, so the test asserts httpOnly +
    // SameSite and documents why the third flag cannot be checked here.
    title: "Session cookie is httpOnly, Secure, SameSite=Lax",
    level: "e2e",
    spec: "docs/08 §2.1",
    critical: true,
  },

  // ── P2 · Data model, storage, templates ────────────────────────────
  {
    id: "F2.1",
    phase: "P2",
    title: "Storage service round-trips an object through S3 (put/head/copy/delete)",
    level: "integration",
    spec: "docs/05 §4",
    critical: true,
  },
  {
    id: "F2.2",
    phase: "P2",
    title: "Presigned upload URL carries a content-length-range condition",
    level: "integration",
    spec: "docs/03 §3.6",
    critical: true,
  },
  {
    id: "F2.3",
    phase: "P2",
    title: "Presigned download URL expires and sets a Content-Disposition filename",
    level: "integration",
    spec: "docs/03 §3.9",
    critical: false,
  },
  {
    id: "F2.4",
    phase: "P2",
    title: "Manifest schema accepts the canonical valid fixture for all four types",
    level: "unit",
    spec: "docs/06 §5",
    critical: true,
  },
  {
    id: "F2.5",
    phase: "P2",
    title: "Manifest schema rejects unknown keys (strict mode)",
    level: "unit",
    spec: "docs/06 §2",
    critical: true,
  },
  {
    id: "F2.6",
    phase: "P2",
    title: "Manifest schema rejects malformed semver, non-https URLs, bad slugs",
    level: "unit",
    spec: "docs/06 §3.1",
    critical: true,
  },
  {
    id: "F2.7",
    phase: "P2",
    title:
      "Type-specific refinements fire (stdio needs command, unique tool names, plugin needs a hook or command)",
    level: "unit",
    spec: "docs/06 §4",
    critical: true,
  },
  {
    id: "F2.8",
    phase: "P2",
    title: "ZodError paths serialize as tools[0].name, not tools,0,name",
    level: "unit",
    spec: "docs/06 §5.1",
    critical: true,
  },
  {
    id: "F2.9",
    phase: "P2",
    title: "All four templates validate against the real manifest schema",
    level: "unit",
    spec: "docs/07 §4",
    critical: true,
  },
  {
    id: "F2.10",
    phase: "P2",
    title: "Every path a template manifest declares exists inside the archive",
    level: "unit",
    spec: "docs/07 §4",
    critical: true,
  },
  {
    id: "F2.11",
    phase: "P2",
    title: "Template archives place component.json at the zip ROOT",
    level: "unit",
    spec: "docs/07 §2",
    critical: true,
  },
  {
    id: "F2.12",
    phase: "P2",
    title: "Template download requires auth and records a Download row",
    level: "integration",
    spec: "docs/04 Flow 2",
    critical: true,
  },
  {
    id: "F2.13",
    phase: "P2",
    title: "Seed script is idempotent — running it twice changes no row counts",
    level: "integration",
    spec: "docs/02 §6",
    critical: false,
  },

  // ── P3 · Manifest validation & publishing (CRITICAL PATH) ──────────
  {
    id: "F3.1",
    phase: "P3",
    title: "Archive inspector rejects zip-slip (.. path segments)",
    level: "unit",
    spec: "docs/08 §4 row 1",
    critical: true,
  },
  {
    id: "F3.2",
    phase: "P3",
    title: "Archive inspector rejects absolute paths and drive prefixes",
    level: "unit",
    spec: "docs/08 §4 row 1",
    critical: true,
  },
  {
    id: "F3.3",
    phase: "P3",
    title: "Archive inspector aborts a decompression bomb EARLY, without full read",
    level: "unit",
    spec: "docs/08 §4 row 2",
    critical: true,
  },
  {
    id: "F3.4",
    phase: "P3",
    title: "Archive inspector rejects an entry-count flood",
    level: "unit",
    spec: "docs/08 §4 row 3",
    critical: true,
  },
  {
    id: "F3.5",
    phase: "P3",
    title: "Archive inspector rejects symlink entries",
    level: "unit",
    spec: "docs/08 §4 row 4",
    critical: true,
  },
  {
    id: "F3.6",
    phase: "P3",
    title: "Archive inspector computes a stable SHA-256 over the stream",
    level: "unit",
    spec: "docs/03 §3.7",
    critical: true,
  },
  {
    id: "F3.7",
    phase: "P3",
    title: "Missing component.json yields MANIFEST_MISSING",
    level: "unit",
    spec: "docs/03 §3.7",
    critical: true,
  },
  {
    id: "F3.8",
    phase: "P3",
    title: "A manifest one level deep yields the actionable 'zip the contents' hint",
    level: "unit",
    spec: "docs/07 §2",
    critical: false,
  },
  {
    id: "F3.9",
    phase: "P3",
    title: "Manifest secret-pattern scan rejects and never echoes the matched value",
    level: "unit",
    spec: "docs/06 §7",
    critical: true,
  },
  {
    id: "F3.10",
    phase: "P3",
    title: "Presign rejects an oversize declared size with 413",
    level: "integration",
    spec: "docs/03 §3.6",
    critical: true,
  },
  {
    id: "F3.11",
    phase: "P3",
    title: "Presign derives the key server-side; a client-supplied key is ignored",
    level: "integration",
    spec: "docs/08 §4 row 7",
    critical: true,
  },
  {
    id: "F3.12",
    phase: "P3",
    title: "Publishing with another user's stagingKey yields STAGING_FORBIDDEN",
    level: "integration",
    spec: "docs/08 §4 row 6",
    critical: true,
  },
  {
    id: "F3.13",
    phase: "P3",
    title: "Valid publish creates Component + Version + tags + audit in ONE transaction",
    level: "integration",
    spec: "docs/04 Flow 3",
    critical: true,
  },
  {
    id: "F3.14",
    phase: "P3",
    title: "Invalid manifest returns 422 with per-field details[] and writes NO rows",
    level: "integration",
    spec: "docs/03 §3.7",
    critical: true,
  },
  {
    id: "F3.15",
    phase: "P3",
    title: "Staging object is deleted on BOTH the success and rejection paths",
    level: "integration",
    spec: "docs/04 Flow 3",
    critical: true,
  },
  {
    id: "F3.16",
    phase: "P3",
    title: "A crash after CopyObject leaves an orphaned object, never a dangling row",
    level: "integration",
    spec: "docs/01 §5.2",
    critical: true,
  },
  {
    id: "F3.17",
    phase: "P3",
    title:
      "Duplicate slug yields 409 SLUG_TAKEN; duplicate checksum yields DUPLICATE_ARCHIVE",
    level: "integration",
    spec: "docs/03 §3.7",
    critical: true,
  },
  {
    id: "F3.18",
    phase: "P3",
    title: "New version must strictly increase by semver (1.10.0 > 1.9.0)",
    level: "unit",
    spec: "docs/03 §3.8",
    critical: true,
  },
  {
    id: "F3.19",
    phase: "P3",
    title: "A component's type can never change across versions",
    level: "integration",
    spec: "docs/03 §3.8",
    critical: true,
  },
  {
    id: "F3.20",
    phase: "P3",
    title: "Publishing promotes the owner from USER to PUBLISHER",
    level: "integration",
    spec: "docs/04 Flow 3",
    critical: false,
  },
  {
    id: "F3.21",
    phase: "P3",
    title: "Presign rate limit returns 429 with Retry-After",
    level: "integration",
    spec: "docs/03 §4",
    critical: false,
  },
  {
    id: "F3.22",
    phase: "P3",
    title: "Upload wizard renders field-level errors against the right inputs",
    level: "e2e",
    spec: "docs/04 Flow 3",
    critical: false,
  },

  // ── P4 · Catalog & discovery ───────────────────────────────────────
  {
    id: "F4.1",
    phase: "P4",
    title: "Full-text search ranks a title match above a README match",
    level: "integration",
    spec: "docs/02 §4",
    critical: true,
  },
  {
    id: "F4.2",
    phase: "P4",
    title: "Malformed search input degrades gracefully instead of throwing",
    level: "integration",
    spec: "docs/02 §4",
    critical: true,
  },
  {
    id: "F4.3",
    phase: "P4",
    title: "Type and tag filters compose correctly with search",
    level: "integration",
    spec: "docs/03 §3.4",
    critical: true,
  },
  {
    id: "F4.4",
    phase: "P4",
    title: "Facet counts agree with the returned row counts",
    level: "integration",
    spec: "docs/03 §3.4",
    critical: false,
  },
  {
    id: "F4.5",
    phase: "P4",
    title: "Pagination is stable and total/totalPages are correct",
    level: "integration",
    spec: "docs/03 §3.4",
    critical: false,
  },
  {
    id: "F4.6",
    phase: "P4",
    title: "Soft-deleted components never appear in the catalog",
    level: "integration",
    spec: "docs/02 §2.3",
    critical: true,
  },
  {
    id: "F4.7",
    phase: "P4",
    title: "SUSPENDED components 404 for normal users, visible to ADMIN",
    level: "integration",
    spec: "docs/03 §3.4",
    critical: true,
  },
  {
    id: "F4.8",
    phase: "P4",
    title: "README markdown is sanitized — an onerror payload renders inert",
    level: "unit",
    spec: "docs/08 §4 row 9",
    critical: true,
  },
  {
    id: "F4.9",
    phase: "P4",
    title: "Download requires auth, increments counters, and hashes the IP",
    level: "integration",
    spec: "docs/03 §3.9",
    critical: true,
  },
  {
    id: "F4.10",
    phase: "P4",
    title: "PATCH rejects attempts to change immutable fields (name, type, slug)",
    level: "integration",
    spec: "docs/03 §3.10",
    critical: true,
  },
  {
    id: "F4.11",
    phase: "P4",
    title: "Admin suspend hides the component and writes an audit row",
    level: "integration",
    spec: "docs/03 §3.12",
    critical: false,
  },
  {
    id: "F4.12",
    phase: "P4",
    title: "Catalog URL state survives refresh and the back button",
    level: "e2e",
    spec: "docs/04 Flow 4",
    critical: false,
  },

  // ── P5 · Harden & ship ─────────────────────────────────────────────
  {
    id: "F5.1",
    phase: "P5",
    title: "Container runs as a non-root user",
    level: "manual",
    spec: "docs/05 §5",
    critical: true,
  },
  {
    id: "F5.2",
    phase: "P5",
    title: "Security headers present on every response",
    level: "integration",
    spec: "docs/08 §6",
    critical: true,
  },
  {
    id: "F5.3",
    phase: "P5",
    title: "CSP connect-src permits the storage origin so direct upload works",
    level: "manual",
    spec: "docs/08 §6",
    critical: true,
  },
  {
    id: "F5.4",
    phase: "P5",
    title: "E2E: sign in, then download a template",
    level: "e2e",
    spec: "docs/11 §4",
    critical: true,
  },
  {
    id: "F5.5",
    phase: "P5",
    title: "E2E: publish a component, then find it in the catalog",
    level: "e2e",
    spec: "docs/11 §4",
    critical: true,
  },
  {
    id: "F5.6",
    phase: "P5",
    title: "CI fails when schema.prisma is edited without a migration",
    level: "manual",
    spec: "docs/10 §2",
    critical: true,
  },
];

export const featureById = new Map(FEATURES.map((f) => [f.id, f]));
