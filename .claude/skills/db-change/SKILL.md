---
name: db-change
description: Safely change the database schema — edit schema.prisma, generate a migration, update the data-model doc, and verify no drift. Use whenever a model, field, index, or enum needs to change. Prevents the most common solo-developer deploy break.
---

# /db-change — change the schema safely

The failure this prevents: editing `schema.prisma`, forgetting to generate a migration,
and shipping a build that crashes on boot because production's schema does not match.

## Before touching anything

1. Read [`docs/02-data-model.md`](../../../docs/02-data-model.md) — the schema of record.
2. Read `.claude/rules/40-database-and-prisma.md`.
3. Confirm Postgres is up: `docker compose ps` (start it with `npm run docker:up`).
4. Check the change against the **invariants** — if it would break one, stop and ask:
   - `ComponentVersion` rows are insert-only
   - `(componentId, version)` unique; `checksumSha256` globally unique
   - `Component.latestVersionId` written in the same transaction as the version insert
   - a component's `type` never changes

## Procedure

```powershell
# 1 — edit prisma/schema.prisma

# 2 — sanity check before generating anything
npx prisma validate
npx prisma format

# 3 — generate the migration (never `db push`)
npm run db:migrate -- --name add-component-deprecation-reason

# 4 — regenerate the typed client
npx prisma generate

# 5 — the compiler now tells you every call site that must change
npm run typecheck

# 6 — confirm the seed still works and is still idempotent
npm run db:seed
npm run db:seed        # twice — row counts must be identical

# 7 — no drift between schema and migrations
npx prisma migrate diff --from-migrations prisma/migrations `
  --to-schema-datamodel prisma/schema.prisma `
  --shadow-database-url $env:DATABASE_URL --exit-code
```

## Then update the docs — same commit

- [`docs/02-data-model.md`](../../../docs/02-data-model.md) — the Prisma schema block and,
  if relationships changed, the ERD
- [`docs/03-api-contract.md`](../../../docs/03-api-contract.md) — if any response shape
  changed
- A new ADR if the change reflects a real modelling decision rather than a field addition

## Rules that are not negotiable

- **Forward-only.** Never edit an applied migration. To undo, write a new one. (The
  `protect-sensitive` hook blocks this.)
- **Never `prisma db push`** outside a throwaway database. It skips migration history.
- **Never `prisma migrate reset`** without explicit permission — it drops all data.
- Schema change and migration go in the **same commit**. CI fails otherwise.
- Additive by default. A destructive change (drop column, narrow a type) follows
  **expand → migrate → contract**: add the new thing, backfill, move readers, drop the old
  thing in a later release.

## For a raw-SQL migration

Some things Prisma cannot express — the generated `tsvector` column, GIN indexes,
extensions. Create an empty migration and write the SQL by hand:

```powershell
npx prisma migrate dev --create-only --name search-vector
# edit prisma/migrations/<timestamp>_search_vector/migration.sql
npm run db:migrate
```

Use `IF NOT EXISTS` so the migration is safely re-runnable. Reference:
[`docs/02 §4`](../../../docs/02-data-model.md#4-full-text-search).

## Report

```
## Schema change: add Component.deprecationReason

  prisma/schema.prisma          + deprecationReason String? @db.Text
  prisma/migrations/20260812…   new
  docs/02-data-model.md         schema block updated
  src/server/repositories/…     2 call sites updated (surfaced by typecheck)

  ✓ validate  ✓ typecheck  ✓ seed idempotent  ✓ no drift
```
