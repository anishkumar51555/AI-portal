# ADR-006 — A formal, enforced manifest specification

- **Status:** Accepted
- **Date:** 2026-08-09
- **Related:** [`06-component-manifest-spec.md`](../06-component-manifest-spec.md)

## Context

The portal accepts uploads of four structurally different component types. The question is
how much structure to demand.

Anything from "accept any zip and let the uploader type a description into a form" to
"enforce a strict, versioned, type-specific schema" is defensible. The choice determines
whether the result is a file host or a platform.

## Options considered

### A — No manifest; metadata via a web form

- ➕ Simplest; nothing to specify or validate
- ➖ Nothing is guaranteed. Two components of the same "type" can have nothing in common.
- ➖ No tooling is possible — nothing to lint, index, or diff against
- ➖ Metadata drifts from the code the moment either changes
- ➖ Reduces the project to a CRUD app with file upload

### B — Loose manifest: a few required fields, unknown keys allowed

- ➕ Low friction for publishers
- ➖ Typos pass silently (`decsription` is just an unknown key)
- ➖ Type-specific structure is unenforceable, so the detail page cannot render it

### C — Strict, versioned, type-discriminated schema, rejected at the gate

- ➕ Every published component is guaranteed well-formed
- ➕ Type-specific detail pages become possible (an MCP gateway can list its tools)
- ➕ The published JSON Schema gives authors editor autocomplete
- ➕ `specVersion` allows evolution without breaking existing components
- ➕ Validation errors are precise and actionable
- ➖ Higher publishing friction
- ➖ Real work: four schemas plus cross-field rules

## Decision

**Option C — a strict `component.json` with `.strict()` on every object, a
discriminated union on `type`, and rejection at the gate.**

Decisive factor: **this is what makes the project a platform rather than a file host.**
Every downstream capability worth having — typed detail pages, filtering by capability,
future CLI scaffolding and linting, machine-readable discovery — is unlocked by one file
being guaranteed well-formed. That leverage does not exist under options A or B.

Sub-decision — **`.strict()` rather than `.passthrough()`**: a typo should be a loud error
at publish time, not a silently missing field found three weeks later by a consumer.
Unforgiving is correct for a registry.

Sub-decision — **`z.discriminatedUnion` rather than `z.union`**: a plain union produces
four parallel error trees; the discriminated union reads `type` first and reports errors
only for the matching branch. The difference is the entire quality of the error message,
which is the feature.

## Consequences

**Positive**

- The catalog contains only structurally valid components. Always.
- The rejection demo — a broken manifest producing three precise field errors — is the
  most compelling 30 seconds of the whole project.
- Templates are validated by the _same_ code path as user uploads, so they cannot drift.
- One Zod definition yields runtime validation, TypeScript types, and the published JSON
  Schema.

**Negative**

- Publishing friction is real. Mitigations: templates ship with a valid manifest;
  `$schema` gives editor autocomplete; error messages name the exact field and path.
- Four schemas plus cross-field rules is roughly a day of careful work.
- `.strict()` will occasionally reject something a user considered reasonable. That is the
  intended behaviour, and the error message must be good enough to make it obvious why.

**Neutral**

- `specVersion` is an unused field in v1 and pure cost today. It is the mechanism that
  makes v2 possible without breaking anyone, so it ships now.

## Revisit when

A fifth component type is needed (add a branch — the union is designed for it), or v1
proves too restrictive in a specific, evidenced way. Then write ADR-0NN for spec v2 and
serve both schemas. **v1 is frozen once the first external component is published.**
