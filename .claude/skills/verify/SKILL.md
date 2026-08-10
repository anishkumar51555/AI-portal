---
name: verify
description: Run the full local verification gate — the same checks CI runs. Use when a task from the implementation plan is finished, before committing, or when the developer asks whether something is actually working. Reports honestly; does not fix.
---

# /verify — the local CI gate

Run the same checks CI runs, in the order that fails fastest. **Report results honestly.
Do not fix anything unless asked** — the point is an accurate status, not a green light.

## Steps

Stop at the first failure and report it. There is no value in running Playwright when
`tsc` is broken.

```powershell
# 1 — formatting (fastest)
npm run format:check

# 2 — lint, including the architecture boundary rules
npm run lint

# 3 — types
npm run typecheck

# 4 — unit tests with coverage
npm run test:unit -- --coverage

# 5 — schema/migration drift (only if prisma/ exists)
npx prisma validate
npx prisma migrate diff --from-migrations prisma/migrations `
  --to-schema-datamodel prisma/schema.prisma `
  --shadow-database-url $env:DATABASE_URL --exit-code

# 6 — templates still satisfy the real manifest schema (only if templates/ exists)
npm run templates:verify

# 7 — integration tests (needs containers; skip with a note if they are down)
docker compose ps
npm run test:integration

# 8 — production build
npm run build
```

Skip any step whose script does not exist yet and **say which ones you skipped**. Early in
the project most of these will not exist; that is expected, not a failure.

## Then check by hand

Grep-level checks that no linter covers:

```powershell
# every mutating handler must call a guard
Select-String -Path src/app/api -Include *.ts -Recurse -Pattern 'export async function (POST|PATCH|DELETE|PUT)'
# → confirm each one has requireAuth / requireRole / requireOwnership

# XSS
Select-String -Path src -Include *.tsx,*.ts -Recurse -Pattern 'dangerouslySetInnerHTML'
# → must be empty

# boundary violations the lint rule might not cover
Select-String -Path src/app -Include *.ts,*.tsx -Recurse -Pattern "from '@prisma/client'"
Select-String -Path src/server/services -Include *.ts -Recurse -Pattern "from 'next/"
# → both must be empty

# debug leftovers
Select-String -Path src -Include *.ts,*.tsx -Recurse -Pattern 'console\.(log|debug)'
Select-String -Path tests -Include *.ts -Recurse -Pattern '\.only\('
# → both must be empty
```

## Report format

```
## Verification

✓ format        clean
✓ lint          clean
✗ typecheck     2 errors
                src/server/services/component.service.ts:88
                  Type 'string | undefined' is not assignable to 'string'
                src/app/api/components/route.ts:34
                  Property 'checksumSha256' does not exist on type 'PublishResult'
– unit          not run (stopped at typecheck)
– integration   skipped, containers not running
⊘ templates     script does not exist yet

Manual checks:
✓ all 6 mutating handlers call a guard
✓ no dangerouslySetInnerHTML
✗ src/app/catalog/page.tsx:12 imports @prisma/client directly — boundary violation

Verdict: NOT READY. Fix the two type errors and the boundary violation.
```

Legend: `✓` passed · `✗` failed · `–` not run · `⊘` not applicable yet.

## Rules

- **Never report a pass you did not observe.** If a command was not run, mark it `–`.
- Quote real error output, trimmed. Do not paraphrase a compiler error.
- Give a single clear verdict: READY or NOT READY.
- If asked to fix, fix one failure at a time and re-run that step before moving on.
