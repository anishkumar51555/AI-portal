# Rule 00 — Project context

## What this is

A registry and template hub for four AI component types. The differentiating feature is a
**formal, enforced manifest specification** (`component.json`) — not the CRUD around it.
When trading off effort, spend it on validation quality and error-message precision.

## The four types

`SKILL` · `PLUGIN` · `AGENT` · `MCP_GATEWAY`

SCREAMING_SNAKE in the database and TypeScript enums. **kebab-case in URLs and in the
manifest** (`mcp-gateway`). Convert at the edge — never leak `MCP_GATEWAY` into a URL or
`mcp-gateway` into a Prisma query.

## Who is building this

A final-year student, strong in React/Node, new to TypeScript, Next.js App Router, Prisma,
and Docker. They will be asked about this code in interviews.

**Consequences for how you work:**

- Prefer the clear implementation over the clever one.
- When you use a non-obvious pattern, add one comment saying _why_, not _what_.
- Do not silently introduce advanced abstractions. If a generic, a decorator, or a
  higher-order factory is genuinely warranted, say so and explain it.
- Never leave code they could not explain out loud.

## Timeline

17 working days across 6 phases. Phase 3 (manifest + publish) is the critical path.
Scope creep is the primary risk — the non-goals list in
[`docs/00-overview.md §3`](../../docs/00-overview.md#3-non-goals--explicitly-out-of-scope-for-v1)
is binding, not advisory.

## Explicitly out of scope for v1

Executing or sandboxing uploaded code · dependency resolution · organizations and teams ·
private components · payments · ratings and comments · federation · a companion CLI ·
malware scanning of archive _contents_ · semver range resolution.

If a task seems to require one of these, stop and ask. The answer is almost always that
the task has been misread.

## Vocabulary — use these terms exactly

| Term        | Means                                                                 |
| ----------- | --------------------------------------------------------------------- |
| Component   | A publishable unit; always exactly one of the four types              |
| Manifest    | `component.json` at the archive root                                  |
| Template    | A portal-authored starter archive; itself a valid component           |
| Version     | An immutable published release                                        |
| Staging key | `staging/{userId}/{ulid}.zip` — pre-validation, never catalog-visible |
| Object key  | The permanent storage path for a validated release                    |
| Slug        | URL-safe unique component identifier                                  |

Do not invent synonyms. "Package", "module", "artifact", and "bundle" are not terms in
this project.
