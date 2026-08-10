# Rule 10 — TypeScript

## Compiler settings — do not weaken these

```jsonc
"strict": true,
"noUncheckedIndexedAccess": true,          // arr[0] is T | undefined
"noImplicitOverride": true,
"noFallthroughCasesInSwitch": true,
"forceConsistentCasingInFileNames": true   // Windows dev, Linux CI — mandatory
```

If a setting causes friction, fix the code. Never relax the setting.

## Hard rules

- **No `any`.** Use `unknown` and narrow. If you genuinely cannot type something, write
  `unknown` plus a Zod parse.
- **No `@ts-expect-error` or `@ts-ignore`** without a comment on the line above stating
  why and what would remove it.
- **No non-null assertion (`!`)** except immediately after a check the compiler cannot
  see, with a comment. Prefer narrowing.
- **No type assertions (`as`)** to silence an error. `as` is for narrowing `unknown` after
  a runtime check, and for `as const`.

## Types come from one source

| Kind            | Source                                                           |
| --------------- | ---------------------------------------------------------------- |
| Database rows   | Prisma generated types. Never hand-write a model interface.      |
| Validated input | `z.infer<typeof schema>`. Never hand-write a parallel interface. |
| API responses   | Derived from the domain type, not redeclared                     |

Duplicating a type is how they drift. If you find yourself writing an interface that
mirrors a Zod schema, delete it and use `z.infer`.

## Prefer

```ts
// Union of literals over enum-like strings
type ComponentStatus = "PUBLISHED" | "DEPRECATED" | "SUSPENDED";

// Discriminated unions over optional-field soup
type Result<T> = { ok: true; data: T } | { ok: false; error: AppError };

// as const for literal inference
const TYPES = ["skill", "plugin", "agent", "mcp-gateway"] as const;
type ComponentType = (typeof TYPES)[number];

// satisfies to check without widening
const config = { maxSize: 10_485_760 } satisfies UploadLimits;
```

## Naming

| Thing                 | Convention                  | Example                                        |
| --------------------- | --------------------------- | ---------------------------------------------- |
| Files                 | kebab-case                  | `archive.inspector.ts`, `component.service.ts` |
| React components      | PascalCase file and export  | `ComponentCard.tsx`                            |
| Types / interfaces    | PascalCase, no `I` prefix   | `ComponentManifest`                            |
| Functions / variables | camelCase                   | `validateManifest`                             |
| Constants             | SCREAMING_SNAKE             | `MAX_UPLOAD_BYTES`                             |
| Zod schemas           | camelCase + `Schema`        | `manifestSchema`, `publishBodySchema`          |
| Booleans              | `is` / `has` / `can` prefix | `isPublished`, `canDownload`                   |

## Async

- `async`/`await` everywhere. No `.then()` chains.
- Independent awaits go in `Promise.all`. Sequential awaits that do not depend on each
  other are a latency bug.
- Every `await` on a fallible external call is inside a `try` or bubbles to the route's
  error boundary. Never swallow an error silently.

## Imports

- Path alias `@/*` → `src/*`. No `../../../`.
- Type-only imports use `import type { … }`.
- Import order, enforced by ESLint: node builtins → external → `@/domain` → `@/server` →
  `@/components` → `@/lib` → relative.
