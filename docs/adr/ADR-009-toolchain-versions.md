# ADR-009 — Pinning bleeding-edge toolchain versions

- **Status:** Accepted
- **Date:** 2026-08-09
- **Related:** [`01-architecture.md §7`](../01-architecture.md#7-technology-choices-with-the-version-pinned), [`09-implementation-plan.md` task 0.2](../09-implementation-plan.md#phase-0--foundation-days-12)

## Context

Checked against the npm registry on 2026-08-09, `latest` for the core toolchain is:

| Package      | latest          | Note                                         |
| ------------ | --------------- | -------------------------------------------- |
| `typescript` | `7.0.2`         | **Major** — the native (Go) compiler rewrite |
| `next`       | `16.3.0`        | Major since Next 15                          |
| `prisma`     | `7.9.1`         | Major since Prisma 6                         |
| `zod`        | `4.4.3`         | Major — v3 → v4 has real API changes         |
| `eslint`     | `10.8.1`        | Major                                        |
| `next-auth`  | `5.0.0-beta.32` | Still beta after ~2 years                    |

Every one of these has landed a major version recently. The ecosystem — plugins, types,
tutorials — lags majors by months. This is the single largest schedule risk in a 17-day
plan.

## Options considered

### A — Latest everything

- ➕ Fastest tooling; modern APIs; nothing deprecated on arrival
- ➕ Fewer migrations later
- ➖ Plugin incompatibilities, thin documentation, and answers online that are wrong for
  your version
- ➖ A blocker on day 12 is very expensive

### B — Conservative: previous major of everything

- ➕ Battle-tested; tutorials match; every plugin works
- ➖ Ships something visibly a year behind
- ➖ Migration debt from day one

### C — Latest, with a **day-1 compatibility gate** and pre-decided fallbacks

- ➕ Modern by default
- ➕ Incompatibility is discovered in hour 3, not on day 12
- ➕ The fallback is decided in advance, so hitting it costs an hour, not a day of panic
- ➖ Requires the discipline to actually run the gate first

## Decision

**Option C.** Pin everything to the versions in
[`01 §7`](../01-architecture.md#7-technology-choices-with-the-version-pinned), and make
**task 0.2 a hard gate** before any feature work:

```powershell
npx tsc --noEmit          # TypeScript 7 accepts the config
npx eslint .              # ESLint 10 flat config loads, plugins resolve
npx prisma generate       # Prisma 7 emits a client TS 7 accepts
npm run build             # Next 16 builds it all together
```

All four must exit 0. If any fails and is not fixable within one hour:

| Failing             | Fallback                                        | Cost                                            |
| ------------------- | ----------------------------------------------- | ----------------------------------------------- |
| TypeScript 7        | Latest `6.x`                                    | ~30 min                                         |
| ESLint 10           | `9.x` with the same flat config                 | ~30 min                                         |
| Zod 4               | `3.25.x` (`z.url()` → `z.string().url()`, etc.) | ~1 h                                            |
| Next 16             | `15.x`                                          | ~1 h                                            |
| `next-auth` v5 beta | `4.24.15`                                       | ~4 h — see [ADR-004](ADR-004-authentication.md) |

Record whichever fallback is taken by superseding this ADR.

Decisive factor: **the cost of a version problem is a function of when you find it.** On
day 1 it is an hour. On day 12 it is the project. The gate converts an unbounded risk into
a bounded one.

## Consequences

**Positive**

- The project uses current tooling, which matters when someone reads `package.json`.
- The risk is discovered and priced on day 1.
- Being able to say "I pinned exact versions and gated compatibility before building" is
  itself a maturity signal.

**Negative**

- Some answers found online will be for the previous major. Read the official docs, not
  blog posts.
- `next-auth` is pinned exactly, so it will not receive patch fixes automatically.
  Deliberate: a beta patch can break things.
- Zod 4's API differs from the v3 examples that dominate search results. The schemas in
  [`06 §5`](../06-component-manifest-spec.md#5-zod-implementation) are written for v4 —
  use them as the reference rather than reaching for tutorials.

**Neutral**

- Dependabot is configured weekly but grouped, so updates arrive as one reviewable PR.

## Revisit when

Task 0.2 fails — supersede this ADR with the actual versions chosen and the reason.
