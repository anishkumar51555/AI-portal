# Rule 20 — Architecture boundaries

## The dependency rule

```
app/  ──▶  server/  ──▶  repositories/  ──▶  Prisma
 │           │
 └───────────┴──▶  domain/          (domain imports nothing)
```

**Arrows only point right.** Enforced by `import/no-restricted-paths` in ESLint; a
violation fails CI.

| Layer                                     | May import                                        | May NOT import                                  |
| ----------------------------------------- | ------------------------------------------------- | ----------------------------------------------- |
| `src/domain/`                             | nothing from this project                         | anything                                        |
| `src/server/repositories/`                | `domain/`, Prisma client                          | `next/*`, `app/`, services                      |
| `src/server/services/`                    | `domain/`, repositories, storage, auth            | **`next/*`**, `app/`, `@prisma/client` directly |
| `src/server/auth/`, `src/server/storage/` | `domain/`, repositories                           | `app/`                                          |
| `src/app/`                                | everything in `server/`, `domain/`, `components/` | **`@prisma/client`**                            |
| `src/components/`                         | `domain/` types, `lib/`                           | `server/`                                       |

### Why each restriction exists

- **`domain/` imports nothing** → it is pure schemas and types, so it can be imported from
  anywhere including the browser bundle without dragging in server code.
- **`server/services/` must not import `next/*`** → this is what makes services unit
  testable in plain Vitest with no Next runtime, and what would let them be lifted into a
  separate service later. It is the seam.
- **`app/` must not import `@prisma/client`** → keeps database access in one layer, so a
  query can be optimized or cached in exactly one place.

## Layer responsibilities

### `app/` — routing only. Thin.

```ts
export async function POST(req: Request) {
  const requestId = getRequestId(req);
  try {
    const user = await requireAuth(); // 1. authorize
    const body = publishBodySchema.parse(await req.json()); // 2. validate
    const result = await componentService.publish(user, body); // 3. delegate
    return NextResponse.json({ data: result }, { status: 201 }); // 4. shape
  } catch (err) {
    return toResponse(err, requestId);
  }
}
```

Four steps. If a handler is longer than ~25 lines, logic has leaked out of the service.

**Never in `app/`:** business rules, Prisma calls, storage calls, transactions.

### `server/services/` — business logic

Orchestrates repositories, storage, and validators. Owns transactions. Framework-agnostic.
Throws `AppError`; never returns an HTTP response.

### `server/repositories/` — data access

The only place `prisma.*` appears. One function per query. Returns domain types, not raw
Prisma payloads where they differ. Raw SQL lives here with a hand-written return type.

### `domain/` — schemas, types, errors

Zod schemas, inferred types, `AppError`, the error code union. Zero dependencies on the
rest of the project.

## File placement

| Adding              | Goes in                                             |
| ------------------- | --------------------------------------------------- |
| An HTTP endpoint    | `src/app/api/…/route.ts`                            |
| Business logic      | `src/server/services/‹name›.service.ts`             |
| A database query    | `src/server/repositories/‹name›.repository.ts`      |
| A validation schema | `src/domain/schemas/‹name›.ts`                      |
| A shadcn primitive  | `src/components/ui/` (generated — do not hand-edit) |
| Feature UI          | `src/components/features/‹feature›/`                |
| A pure helper       | `src/lib/`                                          |

## When a boundary feels wrong

Stop and say so. Do not add a re-export, a barrel file, or a `// eslint-disable` to route
around the rule. Either the code is in the wrong layer or the rule needs a documented
change — both are conversations, not workarounds.
