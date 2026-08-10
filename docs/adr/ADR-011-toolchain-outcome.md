# ADR-011 — Toolchain versions: the gate result

- **Status:** Accepted
- **Date:** 2026-08-09
- **Supersedes:** [ADR-009](ADR-009-toolchain-versions.md) _(strategy)_ — this ADR records the outcome
- **Related:** [`01-architecture.md §7`](../01-architecture.md#7-technology-choices-with-the-version-pinned), `requirements.txt`

## Context

[ADR-009](ADR-009-toolchain-versions.md) chose "latest everything, with a day-one
compatibility gate and pre-decided fallbacks", on the reasoning that a version problem
costs an hour on day 1 and the project on day 12.

The gate ran on day 0, during dependency installation. **It failed**, twice, exactly as
anticipated. This ADR records what was found and what was chosen.

## What the gate found

### 1. `eslint-plugin-import` and `eslint-plugin-jsx-a11y` do not support ESLint 10

`npm install` failed outright with `ERESOLVE`:

```
peer eslint@"^2 || ... || ^9" from eslint-plugin-import@2.32.0
Found: eslint@10.8.1
```

`eslint-plugin-jsx-a11y@6.10.2` caps at `^9` as well. Neither has an ESLint 10 release.

### 2. `typescript-eslint` does not support TypeScript 7 — the blocking one

```
typescript-eslint@8.66.0
  peerDependencies: { typescript: ">=4.8.4 <6.1.0" }
```

TypeScript 7.0.2 is `latest` on npm and is the native (Go) compiler rewrite. The entire
TS-aware lint layer refuses to run against it. The available combinations were:

| Option                        | TS-aware linting | Verdict                                                                                                                                                  |
| ----------------------------- | :--------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TS 7 + no `typescript-eslint` |        ✗         | Loses `no-explicit-any`, `consistent-type-imports`, and every type-aware rule. Those rules are load-bearing for a project whose core rule is "no `any`". |
| TS 7 + no linting at all      |        ✗         | Not a serious option                                                                                                                                     |
| **TS 6.0.3 + ESLint 9.39.5**  |        ✓         | Everything resolves; every gate passes                                                                                                                   |

## Decision

**TypeScript `~6.0.3`, ESLint `~9.39.5`, `@eslint/js ~9.39.5`.** Everything else stays at
the version [ADR-009](ADR-009-toolchain-versions.md) selected: Next 16.3.0, React 19.2.8,
Prisma 7.9.1, Zod 4.4.3, Vitest 4.1.10, Tailwind 4.3.3, `next-auth@5.0.0-beta.32` exact.

Decisive factor: **a linter that understands types is worth more than a faster compiler.**
TS 7's headline benefit is build speed, which is not a constraint on a project this size.
`typescript-eslint`'s type-aware rules catch real defects, and `.claude/rules/10-typescript.md`
depends on them being enforceable.

Two consequential sub-decisions followed:

**`baseUrl` removed from `tsconfig.json`.** TS 6 emits `TS5101: Option 'baseUrl' is
deprecated and will stop functioning in TypeScript 7.0`. Rather than silence it with
`ignoreDeprecations`, the config now uses relative `paths` with
`moduleResolution: "bundler"`, which needs no `baseUrl`. The eventual TS 7 upgrade is
therefore a version bump and nothing else.

**Layer boundaries enforced with core `no-restricted-imports`, not
`import/no-restricted-paths`.** ESLint's built-in rule expresses the dependency rule
perfectly well through per-layer `files` blocks, reads more clearly, and removes a plugin
whose ESLint 10 support is the very thing blocking the upgrade. `eslint-plugin-import` is
retained for import ordering only.

## Consequences

**Positive**

- Full type-aware linting. `npm run gate` is a real gate.
- Everything resolves without `--legacy-peer-deps` or `--force`, so `npm ci` is
  reproducible in CI.
- Verified green on day 0: `typecheck ✓ lint ✓ build ✓ unit 14/14 ✓`.
- Boundary rules now depend on ESLint core rather than a third-party plugin, so the
  eventual ESLint 10 upgrade has one less blocker.
- The upgrade path is a single unblocking event, not a migration.

**Negative**

- The project is one major behind on TypeScript and ESLint. This needs the one-line
  explanation above if a reviewer asks — and having the answer ready is itself the
  better outcome.
- No TS 7 build-speed gain. Immaterial at this scale.
- `typescript` is pinned with `~` (patch-only), so a careless `npm update` cannot drag TS
  past 6.1 and silently break linting.

**Neutral**

- `requirements.txt` and `docs/01 §7` carry warning notes so nobody "helpfully" upgrades
  these two packages in isolation.

## Revisit when

`typescript-eslint` ships a release whose peer range admits TypeScript 7 **and**
`eslint-plugin-import` / `eslint-plugin-jsx-a11y` publish ESLint 10 support. Then bump
all four together in one PR, run `npm run verify`, and supersede this ADR. Check with:

```powershell
npm view typescript-eslint peerDependencies
npm view eslint-plugin-import peerDependencies
```
