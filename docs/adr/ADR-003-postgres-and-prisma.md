# ADR-003 — PostgreSQL + Prisma over MongoDB + Mongoose

- **Status:** Accepted
- **Date:** 2026-08-09
- **Related:** [`02-data-model.md`](../02-data-model.md)

## Context

The data is unambiguously relational: users own components, components have many versions,
versions belong to exactly one component, components have many tags and tags many
components, downloads reference users, components, versions, or templates.

The problem statement specifies a relational database. My background is MongoDB.

## Options considered

### A — MongoDB + Mongoose

- ➕ Familiar
- ➖ Many-to-many tags require manual array management and hand-rolled integrity
- ➖ No foreign keys — an orphaned version is a code bug away
- ➖ Multi-document transactions require a replica set
- ➖ Full-text search is weaker than Postgres `tsvector`
- ➖ Contradicts the stated requirement

### B — PostgreSQL + Prisma

- ➕ Foreign keys, unique constraints, and check constraints enforce integrity in the
  engine, not in application code you might forget to run
- ➕ Real ACID transactions across five tables
- ➕ `tsvector` + GIN removes the need for a separate search service
- ➕ `jsonb` gives document flexibility exactly where it is wanted (the manifest)
- ➕ Prisma generates TypeScript types from the schema — one source of truth
- ➖ Migrations are a new discipline
- ➖ Prisma's generated client is heavy in serverless

### C — PostgreSQL + Drizzle

- ➕ Lighter, closer to SQL, better serverless story
- ➖ Steeper for someone new to SQL; Prisma's schema file is far more readable
- ➖ Smaller ecosystem and fewer learning resources

## Decision

**Option B — PostgreSQL 16 with Prisma 7.**

Decisive factor: **`ComponentVersion` immutability is a data-integrity guarantee, and
guarantees belong in the database.** `@@unique([componentId, version])` and a unique
checksum make "the same version can never be published twice" true by construction. In
MongoDB that is application logic — and application logic has bugs.

Prisma over Drizzle because `schema.prisma` is legible to someone who has never used
either, and the migration workflow has fewer sharp edges for a first-time SQL user. The
hybrid model — relational columns for what you query, `jsonb` for the polymorphic
manifest — is the genuinely correct shape here, and Postgres is the only option that
offers both.

## Consequences

**Positive**

- Referential integrity is enforced by the engine. A deleted user cannot leave orphaned
  components.
- One transaction covers the entire publish.
- Search is free — no Elasticsearch container, no sync job.
- `prisma migrate diff --exit-code` in CI catches schema drift automatically.
- Generated types mean a column rename becomes a compile error, not a runtime 500.

**Negative**

- Learning SQL, indexes, and migrations. Roughly two days, and worth every hour — SQL
  outlasts every framework in this stack.
- Prisma in serverless needs a `globalThis` singleton and a pooled connection string.
- The `tsvector` column cannot be expressed in `schema.prisma`; one hand-written
  migration is required (documented in [`02 §4`](../02-data-model.md#4-full-text-search)).

**Neutral**

- Prisma abstracts SQL for common paths but permits `$queryRaw` where it matters — which
  is exactly what full-text search needs.

## Revisit when

Prisma's cold-start weight measurably hurts serverless latency, or the query patterns
outgrow what the query builder expresses cleanly. Drizzle is the migration target.
