# Rule 40 — Database & Prisma

Schema of record: [`docs/02-data-model.md`](../../docs/02-data-model.md).

## Migrations

- `npx prisma migrate dev --name ‹descriptive-name›` in development.
- `npx prisma migrate deploy` in CI/CD. **Never** `db push` outside a throwaway database.
- Migrations are **forward-only**. Never edit one that has been applied anywhere but your
  own machine. To undo, write a new migration.
- Every migration is committed. `prisma/migrations/` is source of truth.
- After editing `schema.prisma`, generate a migration **in the same commit**. CI runs
  `prisma migrate diff --exit-code` and will fail otherwise.
- Destructive changes follow **expand → migrate → contract**: add the new column, backfill,
  move readers, drop the old column in a later release.

## Client

```ts
// src/server/db.ts — one instance, reused across serverless invocations
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["warn", "error"],
  });
if (env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

Instantiating `new PrismaClient()` anywhere else exhausts the connection pool. There is
exactly one.

## Query rules

- Prisma is only ever called from `src/server/repositories/`.
- **Always `select` or `include` explicitly.** Never return a whole row to the client —
  `User` carries `email`; `Account` carries OAuth tokens.
- Always filter soft-deleted rows: `where: { deletedAt: null }`.
- Always scope catalog reads by status: `status: { in: ["PUBLISHED", "DEPRECATED"] }`,
  unless the caller is an `ADMIN`.
- Paginate every list. No unbounded `findMany`.
- **Never** interpolate user input into `$queryRawUnsafe`. Use tagged-template
  `$queryRaw`, which parameterizes.

## N+1

A `findMany` followed by a `.map` containing an `await` is an N+1. Use `include`, or a
single grouped query.

```ts
// ✗ N+1
const components = await prisma.component.findMany();
for (const c of components) c.tags = await prisma.tag.findMany({ where: … });

// ✓ one query
const components = await prisma.component.findMany({
  include: { tags: { include: { tag: true } }, latestVersion: true },
});
```

## Transactions

Use `prisma.$transaction` whenever two or more writes must succeed or fail together.
Publishing writes `Component`, `ComponentVersion`, `Component.latestVersionId`,
`ComponentTag`, `User.role`, and `AuditLog` — all one transaction, no exceptions.

```ts
await prisma.$transaction(async (tx) => {
  const component = await tx.component.create({ … });
  const version   = await tx.componentVersion.create({ … });
  await tx.component.update({ where: { id: component.id },
                              data: { latestVersionId: version.id } });
  await tx.auditLog.create({ … });
});
```

**Keep transactions short.** Never do network I/O — a storage call, an HTTP request —
inside one. The `CopyObject` happens _before_ `$transaction` opens, deliberately
([`docs/01 §5.2`](../../docs/01-architecture.md#52-two-phase-publish-stage--validate--promote)).

## Invariants that must never break

1. `ComponentVersion` rows are **insert-only**. Never `update`, never `delete`.
2. `Component.latestVersionId` is written in the same transaction as the version insert.
3. `(componentId, version)` is unique. `checksumSha256` is globally unique.
4. A component's `type` never changes after creation.
5. `Download.ipHash` is `sha256(ip + salt)`. A raw IP never reaches the database.

## Full-text search

The `searchVector` column is `GENERATED ALWAYS ... STORED` — Postgres maintains it. Never
write to it. Query with `websearch_to_tsquery` (not `to_tsquery`, which throws on
malformed user input). See
[`docs/02 §4`](../../docs/02-data-model.md#4-full-text-search).

## Seeds

`prisma/seed.ts` must be **idempotent** — `upsert`, never `create`. Running it twice
produces identical row counts. Demo data is guarded by `NODE_ENV !== "production"`.
