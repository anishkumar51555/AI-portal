---
phase: P2
phase_name: Data model, storage, templates
last_task: "P2 2.3 storage service - presign/head/copy/delete, 15 integration tests vs MinIO"
next_task: "2.5/2.6 - author the four templates + build script (F2.9-F2.11)"
blocked_by: none
updated: 2026-08-10
---

# Project state

> **This file is the session's entry point.** It is read automatically at session start.
> Update it when you finish a task — four lines of frontmatter plus a tick.

## Where we are

**Phase 1 is COMPLETE** — 7/7 features, gate passed. A real GitHub sign-in was verified
end to end: `User(anishkumar51555)` + `Account(github/oauth)` +
`AuditLog(USER_SIGNED_IN)` rows all present, and the auth cookies carry
`HttpOnly; SameSite=Lax` (checked against live `Set-Cookie` headers, not the config).

**Phase 2 — Data model, storage, templates.** Tasks 2.1–2.4 are done (8/13 features):

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

Verified green: `npm run gate` (212 unit tests), `npm run test:integration` (26 against
live Postgres + MinIO), P0 and P1 feature gates.

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

## Next up — Phase 2

- [x] 2.1 Full catalog schema + migration
- [x] 2.2 Search vector: GENERATED column + GIN + pg_trgm, verified end to end
- [x] 2.4 `component.json` spec: discriminated union + cross-checks → F2.4–F2.8 (94 tests)
- [x] 2.3 storage service — presign, head, copy, delete → F2.1–F2.3 (15 integration tests)
- [ ] **2.5 / 2.6 Author the four templates + build script** → F2.9–F2.11 ← NEXT
- [ ] 2.7 Idempotent seed → F2.13
- [ ] 2.8 / 2.9 `GET /api/templates` + download + `/templates` page → F2.12
- [ ] 2.10 `templates:verify` wired into CI

## Decisions made during the build

| Date       | Decision                                                            | Why                                                                                                                   |
| ---------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 2026-08-09 | TypeScript **6.0.3**, ESLint **9.39.5** — not 7 / 10                | `typescript-eslint` needs TS `<6.1.0`; both ESLint plugins cap at 9. [ADR-011](docs/adr/ADR-011-toolchain-outcome.md) |
| 2026-08-09 | Dropped `baseUrl`; added `allowImportingTsExtensions`               | `baseUrl` is removed in TS 7; scripts import sibling `.ts` via tsx                                                    |
| 2026-08-09 | Boundary rules use core `no-restricted-imports`                     | One less plugin; works on ESLint 9 and 10                                                                             |
| 2026-08-09 | ESLint parser set explicitly to `tseslint.parser`                   | `eslint-config-next` installs its own, which silently disables every type-aware rule                                  |
| 2026-08-09 | **Prisma 7 removed `url` from `datasource`**                        | Connection moved to `prisma.config.ts`; runtime needs `@prisma/adapter-pg`. docs/02 §3 updated.                       |
| 2026-08-09 | Services may not import `@/server/db` either                        | Closing a hole: it exports PrismaClient, so a service could bypass repositories                                       |
| 2026-08-09 | Augment `@auth/core/jwt`, **not** `next-auth/jwt`                   | The latter is a bare re-export; augmenting it silently does nothing and `token.role` stays `unknown`                  |
| 2026-08-09 | Separate `ai-portal-test` bucket, alongside `ai_portal_test` DB     | Integration tests truncate and upload freely without touching dev data                                                |
| 2026-08-09 | Diagnose Docker with `docker info`, never `wsl --list --verbose`    | WSL reports the distro `Stopped` while Docker Desktop 29.x serves fine — it caused a false "backend hung" diagnosis   |
| 2026-08-10 | Presigned **POST**, not PUT, for uploads                            | Only a POST policy supports `content-length-range`; a PUT can pin one exact length that the client itself reported    |
| 2026-08-09 | **shadcn now ships Base UI, not Radix**                             | Composition is `render={<El/>}`, not `asChild`. Every Radix-era shadcn snippet online is wrong for this version.      |
| 2026-08-09 | `SiteHeader` lives in `src/app/_components/`, not `src/components/` | It reads the session; the dependency rule forbids `components/` importing `server/`                                   |
| 2026-08-09 | Path-traversal fixtures forged byte-by-byte                         | `archiver` sanitizes entry names and cannot emit a malicious archive                                                  |
| 2026-08-09 | `archive.inspector` MUST use `decodeStrings: false`                 | yauzl's own validation throws an opaque error that would surface as a 500, not a 422                                  |

## Known issues / watch list

- Nothing is blocking. `.env.local`, Docker, and both databases are all in place.
- `wsl --list --verbose` lies about Docker Desktop 29.x — it says `Stopped` while the
  engine serves fine. Use `docker info`, never the WSL distro state.
- Docker is not on the default PATH; open a new terminal after installing.
- Playwright browsers not installed: `npx playwright install chromium` (~150 MB).
- Not a git repository yet — `git init` before the first commit.
- Do **not** upgrade `typescript` past 6.0.x or `eslint` past 9.x in isolation (ADR-011).
- `next build` rewrites `tsconfig.json` (adds `.next/dev/types`). Expected; commit it.

## Health

| Check                      | Status                                                              |
| -------------------------- | ------------------------------------------------------------------- |
| `npm run format:check`     | ✅ clean                                                            |
| `npm run lint`             | ✅ clean (type-aware)                                               |
| `npm run typecheck`        | ✅ clean                                                            |
| `npm run build`            | ✅ 5 routes + middleware                                            |
| `npm run test:unit`        | ✅ 212 / 212                                                        |
| `npm run test:matrix`      | 32 / 65 · P0 5/5 · P1 7/7 · P2 8/13                                 |
| `npm run test:integration` | ✅ 26 / 26 against live Postgres + MinIO                            |
| Feature gates              | ✅ P0 PASSED · P1 PASSED                                            |
| Docker stack               | ✅ postgres + minio healthy; buckets `ai-portal`, `ai-portal-test`  |
| Migrations                 | ✅ 4 applied to both DBs; searchVector is GENERATED ALWAYS          |
| `npm run test:e2e`         | ⛔ not run — needs `.env.local` + `npx playwright install chromium` |
| Hooks                      | ✅ all three verified                                               |
