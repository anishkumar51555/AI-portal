---
phase: P3
phase_name: Manifest validation and publishing (CRITICAL PATH)
last_task: "P3 3.10-3.12 - publish wizard, inline manifest errors, dashboard. PHASE 3 CODE COMPLETE."
next_task: "Phase 4 - 4.1/4.2 component.repository.search() + GET /api/components (catalog + facets)"
blocked_by: none
updated: 2026-08-14
---

# Project state

> **This file is the session's entry point.** It is read automatically at session start.
> Update it when you finish a task — four lines of frontmatter plus a tick.

## Where we are

**Phase 1 is COMPLETE** — 7/7 features, gate passed. A real GitHub sign-in was verified
end to end: `User(anishkumar51555)` + `Account(github/oauth)` +
`AuditLog(USER_SIGNED_IN)` rows all present, and the auth cookies carry
`HttpOnly; SameSite=Lax` (checked against live `Set-Cookie` headers, not the config).

**Phase 2 is COMPLETE** — 13/13 features, P2 gate passed.

- Full catalog schema migrated (`Component`, `ComponentVersion`, `Tag`, `ComponentTag`,
  `Template`, `Download`).
- Full-text search verified working — a title match ranks **0.79 vs 0.12** for a README
  mention, `extracting` stems to `Extracts`, and hostile input does not throw.
- **Storage service** — `storage.service.ts` + `domain/storage-keys.ts`. Presigned POST
  with `content-length-range`, so MinIO itself rejects oversized, empty, and
  wrong-content-type uploads. Verified: unsigned and tampered URLs are refused.
- **The manifest specification** — `src/domain/schemas/manifest.ts` (the discriminated
  union) plus `manifest-checks.ts` (secret scan, archive cross-validation, semver).
  **94 tests**, `domain/schemas` at 100% lines / 92.75% branches, over the 95%/90% bar.
- **The four templates** — skill, plugin, agent, mcp-gateway. Each is a working project
  with a passing test suite, validated by the _real_ `manifestSchema` at build time.
- **`scripts/build-templates.mts`** — validates, checks every declared path ships, zips
  the directory CONTENTS, checksums. `templates:verify` exits non-zero on a breach and
  now gates CI.
- **`prisma/seed.ts`** — idempotent. 20 tags, 4 templates, 8 demo components. Proven by
  running it twice and asserting `ComponentVersion` ids _and_ `createdAt` are unchanged,
  not merely that the counts match.
- **Templates API + page** — `GET /api/templates` (public) and
  `GET /api/templates/:type/download` (🔒 302 → presigned GET). Verified end to end
  against a running dev server: the page renders, an anonymous download gets 401, and
  following the real presigned URL returns the archive bytes.

**Phase 3 is CODE COMPLETE** — 21/22 features, P3 gate passed. The full loop works:
download a template → publish it back → see it on the dashboard.
The archive inspector, the manifest validator, presign + rate limiting, and the publish
transaction all work end to end. The one remaining P3 feature (F3.22) is the wizard E2E.

**The round trip the product promises is verified**: a Skill template built by
`templates:build`, unmodified, publishes back through `POST /api/components` and lands in
the catalog as a `SKILL`. There is a standing integration test for exactly that.

Verified green: `npm run gate` (299 unit), `npm run test:integration` (93 against live
Postgres + MinIO), `npm run test` (392 together), P0 / P1 / P2 / **P3** feature gates.

## Docker — resolved, and the misdiagnosis worth remembering

Docker works. The engine reports `server=29.6.2 os=linux`, and both containers are
healthy.

**`wsl --list --verbose` is not a reliable signal for Docker Desktop 29.x.** It reports
`docker-desktop  Stopped` even while the engine is serving requests and containers are
running. An earlier session treated that output — plus a `docker desktop status` timeout —
as proof of a hung backend. Both were red herrings.

**Diagnose Docker by asking Docker**, and give it a timeout so a hang cannot masquerade
as a hard failure:

```bash
timeout 30 docker info --format '{{.ServerVersion}} {{.OSType}}'
timeout 30 docker compose ps
```

**When the engine genuinely will not start** (`docker info` prints
`ERROR: … Docker Desktop is unable to start`, and `docker compose up` fails with the same),
the fix that worked on 2026-08-12 was:

```bash
docker desktop restart     # ~30s; `docker desktop start` says "already running" and does nothing
```

Note this is the case the WSL warning above does _not_ cover: `wsl --list --verbose` showed
`docker-desktop  Stopped` both when Docker was fine and when it was genuinely broken. The
distro state carries no information either way — only `docker info` distinguishes them.

The one real, recurring gotcha: **Docker is not on the default PATH.** It installed to
`C:\Users\anish\AppData\Local\Programs\DockerDesktop\resources\bin`, which is on the
_machine_ PATH — so any shell started before the install will not see it. Open a **new**
terminal. In an old one:

```bash
export PATH="/c/Users/anish/AppData/Local/Programs/DockerDesktop/resources/bin:$PATH"
```

## Environment

`.env.local` exists and a real GitHub sign-in has been verified. Containers and
migrations are up to date. Day to day it is just:

```bash
npm run docker:up   # only if the containers are not already running
npm run dev
```

## Done

**Phase 0 — complete**

- [x] 0.1–0.4 Scaffold, toolchain gate, folder skeleton, ESLint with **type-aware** linting
- [x] 0.5/0.6 `docker-compose.yml`, MinIO CORS + staging lifecycle, postgres init SQL
- [x] 0.7 `src/lib/env.ts` — Zod boot validation → **F0.1** (13 tests)
- [x] 0.8 `prisma/schema.prisma` (User, Account, Session, VerificationToken, AuditLog, Role),
      `prisma.config.ts`, `src/server/db.ts` singleton with pg adapter
- [x] 0.9 `src/domain/errors.ts`, `src/lib/logger.ts`, `src/lib/http.ts` → **F0.4**, **F0.5**
- [x] 0.10 `GET /api/health` + `?deep=1`, via health service + repository
- [x] 0.11 `.github/workflows/ci.yml` — static, integration, build, feature-gate, security
- [x] 0.12 npm scripts

**Phase 1 — complete and verified against a real sign-in**

- [x] 1.2 `next-auth@5.0.0-beta.32` + `@auth/prisma-adapter` pinned
- [x] 1.3 Auth.js models + `Role` enum in the schema
- [x] 1.4 `src/server/auth/config.ts` — GitHub provider, Prisma adapter, JWT with `role`
- [x] 1.5 `src/app/api/auth/[...nextauth]/route.ts`
- [x] 1.6 `src/domain/authz.ts` (pure) + `src/server/auth/guards.ts` → **F1.1, F1.2, F1.3, F1.4**
- [x] 1.7 `src/middleware.ts` — cookie-presence redirect + request id
- [x] 1.8 `/login` page, `SiteHeader` with avatar/role/sign-out
- [x] 1.9 `USER_SIGNED_IN` audit row on the `signIn` event
- [x] 1.10 shadcn/ui: button, card, dropdown-menu, avatar, badge, skeleton, separator
- [x] 1.11 `scripts/make-admin.mts`

## Phase 2 — complete

- [x] 2.1 Full catalog schema + migration
- [x] 2.2 Search vector: GENERATED column + GIN + pg_trgm, verified end to end
- [x] 2.4 `component.json` spec: discriminated union + cross-checks → F2.4–F2.8 (94 tests)
- [x] 2.3 storage service — presign, head, copy, delete → F2.1–F2.3 (15 integration tests)
- [x] 2.5 / 2.6 The four templates + reproducible build script → F2.9–F2.11 (38 tests)
- [x] 2.7 Idempotent seed → F2.13 (3 integration tests)
- [x] 2.10 `templates:verify` wired into CI (static job)
- [x] 2.8 / 2.9 `GET /api/templates` + download + `/templates` page → F2.12 (7 tests)

## Phase 3 — code complete (the critical path)

- [x] 3.1 / 3.2 `archive.inspector.ts` + the hostile fixtures → F3.1–F3.8 (21 tests)
- [x] 3.3 `manifest.validator.ts` — parse, schema, secrets, archive + version cross-checks
      → F3.9, F3.18 (24 tests)
- [x] 3.4 Nested-manifest hint — produced by the inspector, surfaced by the wizard's
      error panel ("found my-skill/component.json … zip the CONTENTS")
- [x] 3.5 `POST /api/uploads/presign` · 3.6 `RateLimit` model + service
      → F3.10, F3.11, F3.21 (26 integration tests)
- [x] 3.7 / 3.8 The publish transaction — `POST /api/components` and `…/:slug/versions`
      → F3.12–F3.20 (21 integration tests). **P3 gate PASSES.**
- [x] 3.10–3.12 `/publish` wizard, inline manifest-error rendering, dashboard list + `GET /api/me/components` (5 integration tests)
- [ ] 3.9 `GET …/versions/:version/download` — deferred; it is also P4 task 4.11
- [ ] F3.22 (wizard E2E) — needs `npx playwright install chromium` (~150 MB)

## Decisions made during the build

| Date       | Decision                                                                                                             | Why                                                                                                                                                                                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-09 | TypeScript **6.0.3**, ESLint **9.39.5** — not 7 / 10                                                                 | `typescript-eslint` needs TS `<6.1.0`; both ESLint plugins cap at 9. [ADR-011](docs/adr/ADR-011-toolchain-outcome.md)                                                                                                                                            |
| 2026-08-09 | Dropped `baseUrl`; added `allowImportingTsExtensions`                                                                | `baseUrl` is removed in TS 7; scripts import sibling `.ts` via tsx                                                                                                                                                                                               |
| 2026-08-09 | Boundary rules use core `no-restricted-imports`                                                                      | One less plugin; works on ESLint 9 and 10                                                                                                                                                                                                                        |
| 2026-08-09 | ESLint parser set explicitly to `tseslint.parser`                                                                    | `eslint-config-next` installs its own, which silently disables every type-aware rule                                                                                                                                                                             |
| 2026-08-09 | **Prisma 7 removed `url` from `datasource`**                                                                         | Connection moved to `prisma.config.ts`; runtime needs `@prisma/adapter-pg`. docs/02 §3 updated.                                                                                                                                                                  |
| 2026-08-09 | Services may not import `@/server/db` either                                                                         | Closing a hole: it exports PrismaClient, so a service could bypass repositories                                                                                                                                                                                  |
| 2026-08-09 | Augment `@auth/core/jwt`, **not** `next-auth/jwt`                                                                    | The latter is a bare re-export; augmenting it silently does nothing and `token.role` stays `unknown`                                                                                                                                                             |
| 2026-08-09 | Separate `ai-portal-test` bucket, alongside `ai_portal_test` DB                                                      | Integration tests truncate and upload freely without touching dev data                                                                                                                                                                                           |
| 2026-08-09 | Diagnose Docker with `docker info`, never `wsl --list --verbose`                                                     | WSL reports the distro `Stopped` while Docker Desktop 29.x serves fine — it caused a false "backend hung" diagnosis                                                                                                                                              |
| 2026-08-10 | Presigned **POST**, not PUT, for uploads                                                                             | Only a POST policy supports `content-length-range`; a PUT can pin one exact length that the client itself reported                                                                                                                                               |
| 2026-08-09 | **shadcn now ships Base UI, not Radix**                                                                              | Composition is `render={<El/>}`, not `asChild`. Every Radix-era shadcn snippet online is wrong for this version.                                                                                                                                                 |
| 2026-08-09 | `SiteHeader` lives in `src/app/_components/`, not `src/components/`                                                  | It reads the session; the dependency rule forbids `components/` importing `server/`                                                                                                                                                                              |
| 2026-08-09 | Path-traversal fixtures forged byte-by-byte                                                                          | `archiver` sanitizes entry names and cannot emit a malicious archive                                                                                                                                                                                             |
| 2026-08-09 | `archive.inspector` MUST use `decodeStrings: false`                                                                  | yauzl's own validation throws an opaque error that would surface as a 500, not a 422                                                                                                                                                                             |
| 2026-08-12 | Template archives are **byte-reproducible**: fixed entry date, sorted entries, `append(buffer)` not `archive.file()` | `archive.file()` writes in async-completion order and archiver stamps wall-clock time, so the sha256 changed on every rebuild — a checksum that moves cannot verify anything                                                                                     |
| 2026-08-12 | Entry sort uses code-unit comparison, **not `localeCompare`**                                                        | Locale collation varies with the runtime's ICU data, which would make the "reproducible" build machine-dependent                                                                                                                                                 |
| 2026-08-12 | Build script does steps 1–5; the **seed** does upload + upsert                                                       | Steps 1–5 are pure, so CI validates all four manifests with no containers. docs/07 §4 updated to match.                                                                                                                                                          |
| 2026-08-12 | Template catalog copy is authored in the seed, not read from the manifests                                           | The templates' own manifests carry `my-skill` / "TODO: describe…" placeholders — rendering those on /templates is a bug                                                                                                                                          |
| 2026-08-12 | Seed env via Node's `--env-file-if-exists=.env.local`                                                                | ESM hoists imports, so a top-level `dotenv` call in seed.ts would run _after_ `@/lib/env` had already parsed and thrown                                                                                                                                          |
| 2026-08-12 | Inspector **buffers the compressed archive**, though docs/08 said "streaming"                                        | A ZIP's central directory is at the END of the file, so random access is unavoidable. What must never be inflated is the DECOMPRESSED content, and none of it is. docs/08 §4.2 rewritten to state this precisely                                                 |
| 2026-08-12 | Added a 12th fixture, `backslash-traversal.zip`                                                                      | Mutation testing showed path normalisation was UNTESTED — `windows-path.zip` is caught by the drive-letter check either way. With normalisation disabled, `..\..\evil.txt` was accepted outright                                                                 |
| 2026-08-12 | Bomb test asserts `onEntry` fired **exactly 2** times, not "fewer than 9"                                            | The ratio guard trips on the first payload entry. A loose bound would still pass for an implementation that read the whole bomb first                                                                                                                            |
| 2026-08-12 | `fixtures.test.ts` stripped of its F3.1–F3.8 tags                                                                    | It proves the FIXTURES contain their attacks, not that the inspector rejects them — so `test:matrix` reported all eight as covered while no inspector existed. A tracker that can be satisfied without the feature is worse than none, because it is trusted     |
| 2026-08-12 | Version ordering throws `VERSION_EXISTS` / `VERSION_NOT_INCREASING` (409), separate from `MANIFEST_INVALID` (422)    | The file is valid; it conflicts with what is published. Collapsing them would tell a publisher to "fix your manifest" when the only problem is the number they chose                                                                                             |
| 2026-08-12 | The seed was writing **spec-invalid manifests** — now validated by `validateManifest`                                | It used `manifestVersion` instead of `specVersion` and omitted 3 required fields, so all 8 demo components stored manifests violating the spec the product enforces. Nothing caught it because the seed never validated its own output                           |
| 2026-08-12 | Bad-discriminator gets a bespoke message instead of Zod's                                                            | A discriminated union suppresses every other field error until `type` is valid, so the raw "Invalid discriminator value" is both cryptic and misleadingly narrow                                                                                                 |
| 2026-08-12 | **Both search indexes are now declared in `schema.prisma`**, and `searchVector` carries `@default(dbgenerated())`    | Without them `migrate dev` emits `DROP INDEX` for both plus a `DROP DEFAULT` that fails on a generated column. It actually happened: the indexes were dropped, the migration then failed, and search silently fell back to a sequential scan. docs/02 §4.1       |
| 2026-08-12 | `AppError` gained a `headers` field, merged by `toResponse`                                                          | A 429 without `Retry-After` is not a contract-compliant 429, and `context` is log-only. One place still formats every error                                                                                                                                      |
| 2026-08-12 | `test:matrix` refuses a tag from the wrong test level                                                                | Three features had been marked green by unit tests of helpers, before the endpoints they describe existed. Wrong-level tags no longer count toward coverage; the honest number dropped 40 → 37                                                                   |
| 2026-08-12 | Rate limiting is a fixed window with an atomic `increment`, not sliding                                              | Atomic because read-then-write loses concurrent increments (tested with 20 parallel calls). Fixed-window because the boundary burst is acceptable for abuse damping and avoids a Redis dependency — stated in docs/02 §3.1 rather than glossed over              |
| 2026-08-13 | The `UPLOAD_REJECTED` audit write is **awaited**, not fire-and-forget                                                | A serverless instance can freeze the instant it responds, so an un-awaited write may never land. Caught by a test that read the row back and found nothing. Safe to await — the helper swallows its own errors                                                   |
| 2026-08-13 | Checksum uniqueness is checked **before** slug uniqueness                                                            | A retry of a successful publish trips both. Only `DUPLICATE_ARCHIVE` names the component it already went out as; `SLUG_TAKEN` would tell the publisher to rename something already theirs                                                                        |
| 2026-08-13 | `test:matrix` levels are a HIERARCHY, not exact matches                                                              | An integration test satisfying a `unit` feature is more evidence, not less. Only the downward direction — a unit test claiming an integration feature — is a lie                                                                                                 |
| 2026-08-13 | Manifest→Prisma JSON conversion lives in the repository, not the service                                             | `InputJsonValue` cannot express the manifest's `Record<string, unknown>` fields, and the boundary rule bans `@prisma/client` in services — including type-only imports                                                                                           |
| 2026-08-14 | Upload uses `XMLHttpRequest`, not `fetch`                                                                            | `fetch` still cannot report upload progress in any shipping browser — there is no readable stream for the request body — so a progress bar built on it can only be a lie                                                                                         |
| 2026-08-14 | The wizard NEVER clears the selected file on an error                                                                | Making someone re-pick a 10 MB archive to retry a one-character manifest typo is the fastest way to lose them. Every failure path returns to "Try again" with the file intact                                                                                    |
| 2026-08-14 | `/api/me/components` deliberately does NOT filter `deletedAt` or `status`                                            | It is the inverse of every other read path. "Where did my component go?" is worse than seeing it flagged as suspended or deleted                                                                                                                                 |
| 2026-08-15 | CI runs MinIO as a `docker run` step, not a `services:` container                                                    | `bitnami/minio` was emptied from Docker Hub in Aug 2025 (0 tags; images moved to the frozen `bitnamilegacy/`). Service containers cannot pass a COMMAND, and `minio/minio` needs `server /data` — so it runs as a step, matching docker-compose.yml              |
| 2026-08-15 | The coverage gate moved from the static job to the **integration** job, over the full suite                          | Most of `src/server/` is covered by integration tests, so a unit-only coverage run scored them 0% and failed four global thresholds. Thresholds unchanged — they now measure the population docs/11 §1 actually describes. Full suite: 93% statements, 94% lines |

## Known issues / watch list

- Nothing is blocking. `.env.local`, Docker, and both databases are all in place.
- `wsl --list --verbose` lies about Docker Desktop 29.x — it says `Stopped` while the
  engine serves fine. Use `docker info`, never the WSL distro state.
- Docker is not on the default PATH; open a new terminal after installing.
- Playwright browsers not installed: `npx playwright install chromium` (~150 MB). This
  blocks F3.22 (wizard E2E) and means **the signed-in rendering of `/publish` and
  `/dashboard` has not been eyeballed by anyone** — anonymous requests are verified to
  redirect to `/login?callbackUrl=…`, and every server path behind them has integration
  tests, but the authenticated pages themselves are unviewed. Open them in the browser
  you are already signed into. This is
  also why the 375 px no-horizontal-scroll check in rules/60 has not been verified for
  `/templates` — the layout is single-column on mobile, but nobody has actually looked.
- `/catalog` is linked from the site header and 404s. Pre-existing since Phase 1; it is
  built in Phase 4 task 4.3. Not a regression, but it is a dead link in the nav today.
- CI is live on GitHub. Two failures on 2026-08-15 are fixed: `bitnami/minio` vanished
  upstream, and the coverage gate was measuring a unit-only run. See the decisions table.
- Do **not** upgrade `typescript` past 6.0.x or `eslint` past 9.x in isolation (ADR-011).
- `next build` rewrites `tsconfig.json` (adds `.next/dev/types`). Expected; commit it.

## Health

| Check                        | Status                                                              |
| ---------------------------- | ------------------------------------------------------------------- |
| `npm run format:check`       | ✅ clean                                                            |
| `npm run lint`               | ✅ clean (type-aware)                                               |
| `npm run typecheck`          | ✅ clean                                                            |
| `npm run build`              | ✅ 14 routes + middleware                                           |
| `npm run test:unit`          | ✅ 275 / 275                                                        |
| `npm run test`               | ✅ 311 / 311 (unit + integration together)                          |
| `npm run test:matrix`        | 46 / 65 · P0 5/5 · P1 7/7 · P2 13/13 · **P3 21/22**                 |
| `archive.inspector` coverage | ✅ 96.77% stmts / 91.83% branch (bar: 95 / 90)                      |
| `npm run test:integration`   | ✅ 36 / 36 against live Postgres + MinIO                            |
| `npm run templates:verify`   | ✅ all 4 satisfy spec v1.0; non-zero exit on a breach               |
| `npm run db:seed`            | ✅ idempotent — 3 runs, identical rows                              |
| Feature gates                | ✅ P0 PASSED · P1 PASSED · P2 PASSED                                |
| Docker stack                 | ✅ postgres + minio healthy; buckets `ai-portal`, `ai-portal-test`  |
| Migrations                   | ✅ 4 applied to both DBs; searchVector is GENERATED ALWAYS          |
| `npm run test:e2e`           | ⛔ not run — needs `.env.local` + `npx playwright install chromium` |
| Hooks                        | ✅ all three verified                                               |
