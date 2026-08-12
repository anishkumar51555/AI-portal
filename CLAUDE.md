# AI Component Ecosystem Portal

A registry and template hub for AI components: **Skills**, **Plugins**, **Agents**, and
**MCP Gateways**. Developers download validated boilerplate, build against a published
manifest specification (`component.json`), and publish back into a searchable catalog.
Every upload is validated server-side before it enters.

---

## Start every session here

1. **Read [`PROJECT-STATE.md`](PROJECT-STATE.md)** — current phase, what is done, what is
   next, decisions made during the build. It is short and it is current.
2. **Load only what the task needs** — [`docs/CONTEXT-MAP.md`](docs/CONTEXT-MAP.md) maps
   each kind of work to the exact sections to read. **Do not read `docs/` end to end.**
   It is ~36,000 words; reading it all leaves no room for the actual work.
3. **Run `/next-task`** to pick up the next plan item, or `/resume` for a status summary.

The full design record lives in [`docs/`](docs/README.md) and is the specification. If
code and docs disagree, that is a bug in one of them — resolve it, never silently
diverge. Changing documented behaviour means updating the doc **in the same commit**.

## Stack

Next.js 16 · React 19 · **TypeScript 6.0.3** · PostgreSQL 16 · Prisma 7 ·
Auth.js v5 (GitHub OAuth) · Zod 4 · Tailwind 4 + shadcn/ui · S3-compatible storage
(MinIO dev / Cloudflare R2 prod) · Vitest 4 · Playwright · Docker

> TypeScript is **6.0.3**, not 7, and ESLint is **9.39.5**, not 10 — the ecosystem does
> not support the latest majors yet. Reasoning in
> [ADR-011](docs/adr/ADR-011-toolchain-outcome.md). Do not "upgrade" these.

## Commands

```powershell
npm run dev              # dev server
npm run gate             # format + lint + typecheck + unit  ← run before every commit
npm run verify           # gate + production build
npm run test:matrix      # which features actually have tests
npm run fixtures:build   # regenerate the hostile archive fixtures
npm run docker:up        # postgres + minio
npm run db:migrate       # prisma migrate dev
npm run db:seed          # idempotent seed
```

Full list in `package.json`.

## The eight non-negotiables

Everything else is enforced by ESLint, TypeScript, Prettier, hooks, or the coverage
thresholds — see [`docs/CONTEXT-MAP.md`](docs/CONTEXT-MAP.md#always-in-effect-never-needs-loading).
These eight cannot be checked mechanically, so they live here:

1. **Every external input is Zod-parsed before any other code touches it** — request
   bodies, query strings, Server Action arguments, `component.json`, env vars.
2. **Every protected path calls a guard** from `src/server/auth/guards.ts`. Middleware is
   a UX redirect, never a security boundary.
3. **The client never supplies an object storage key.** The server derives every key.
4. **`ComponentVersion` rows are immutable.** Insert only — never update, never delete.
5. **No `dangerouslySetInnerHTML`.** User markdown goes through `react-markdown` +
   `rehype-sanitize`.
6. **No secrets in code, logs, or error responses.** A 500 body carries a `requestId`
   and nothing else.
7. **Promote storage before committing the database.** An orphaned object is harmless; a
   catalog row pointing at a missing file is a user-visible 404.
8. **Never report a task done with a failing check.** Say what fails.

## Detailed rules — load on demand

Not auto-imported, deliberately. Read the one the task calls for:

| File                                                                                 | Read when                               |
| ------------------------------------------------------------------------------------ | --------------------------------------- |
| [`rules/00-project-context.md`](.claude/rules/00-project-context.md)                 | Unsure about vocabulary or scope        |
| [`rules/10-typescript.md`](.claude/rules/10-typescript.md)                           | Typing something non-obvious            |
| [`rules/20-architecture-boundaries.md`](.claude/rules/20-architecture-boundaries.md) | Adding a file, unsure which layer       |
| [`rules/30-api-and-validation.md`](.claude/rules/30-api-and-validation.md)           | Any endpoint or Server Action           |
| [`rules/40-database-and-prisma.md`](.claude/rules/40-database-and-prisma.md)         | Any schema or query work                |
| [`rules/50-security.md`](.claude/rules/50-security.md)                               | Upload, auth, or rendering user content |
| [`rules/60-ui-and-accessibility.md`](.claude/rules/60-ui-and-accessibility.md)       | Any component or page                   |
| [`rules/70-testing.md`](.claude/rules/70-testing.md)                                 | Writing tests                           |
| [`rules/80-git-and-docs.md`](.claude/rules/80-git-and-docs.md)                       | Committing, or changing docs            |

## Working style

- **One task at a time** from [`docs/09-implementation-plan.md`](docs/09-implementation-plan.md).
  Read its referenced spec sections first.
- **Stop and ask** when the spec is silent or ambiguous. Do not invent a contract.
- **No new dependencies** without saying why and what was rejected.
- **No scope expansion.** The non-goals in
  [`docs/00-overview.md §3`](docs/00-overview.md#3-non-goals--explicitly-out-of-scope-for-v1)
  are binding.
- **Update `PROJECT-STATE.md` when a task finishes.** Four lines. This is what makes the
  next session cheap.
- The developer is a final-year student learning this stack and will be asked about this
  code in interviews. **Explain non-obvious choices in one sentence** as you go, and
  never leave code they could not defend.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
