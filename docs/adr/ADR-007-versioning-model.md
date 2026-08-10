# ADR-007 — Immutable versions in a separate table

- **Status:** Accepted
- **Date:** 2026-08-09
- **Related:** [`02-data-model.md §2.1`](../02-data-model.md#21-why-component-and-componentversion-are-separate-tables)

## Context

The problem statement requires the data layer to "track versioning". Publishers will
iterate; consumers depend on what they downloaded staying what they downloaded.

## Options considered

### A — One row per component, mutable file pointer

- ➕ Simplest schema; no joins in the catalog query
- ➖ Republishing is **destructive** — anyone depending on `1.0.0` silently gets different bytes
- ➖ No history
- ➖ A checksum guarantee becomes meaningless

### B — `Component` + `ComponentVersion`, versions immutable

- ➕ `(componentId, version)` unique forever; nothing ever mutates a version row
- ➕ Per-version checksum makes integrity verifiable
- ➕ Real version history on the detail page
- ➕ Mirrors how npm, PyPI, and container registries actually behave
- ➖ A join, or a denormalized pointer, for every catalog row
- ➖ More storage — every version is retained

### C — Full semver range resolution (`^1.2.0` → best match)

- ➕ What a package manager does
- ➖ Requires a resolver, a lockfile format, and dependency graph handling
- ➖ Out of scope; also a _client_ concern, not a registry one

## Decision

**Option B.** Versions are insert-only. `Component.latestVersionId` is denormalized for
catalog performance and written inside the same transaction as the version insert, so it
cannot drift.

Decisive factor: **immutability is what makes the checksum mean anything.** Without it,
"here is the SHA-256 of what you downloaded" is not a guarantee — the same URL can serve
different bytes tomorrow. With it, a consumer can verify their copy forever. That single
property is the difference between a registry and a file share.

Option C was rejected as out of scope, but the _storage model_ is compatible with adding it
later: versions are already stored individually and comparably.

## Consequences

**Positive**

- Consumers of `1.0.0` are never surprised.
- Version history is a real feature with no extra work.
- Rollback is trivial: download the older version, which still exists.
- `checksumSha256` unique across all versions also blocks duplicate-archive spam for free.

**Negative**

- Storage grows monotonically. At a 10 MB cap and R2's 10 GB free tier that is ~1000
  versions — acceptable, and a retention policy is a v2 concern.
- Every catalog query needs the latest version. Solved by the denormalized pointer, at the
  cost of one invariant to maintain (in exactly one transaction, in one service method).
- Publishing a new version is a more complex code path than an update: name must match,
  type must match, semver must strictly increase.

**Neutral**

- Semver **comparison** is implemented (to enforce increase) but semver **range
  resolution** is not. The distinction is worth stating precisely when asked.

## Revisit when

Storage pressure demands a retention policy (e.g. keep the latest 10 versions plus every
major), or consumers genuinely need range resolution — which only matters once something
_depends_ on registry components programmatically.
