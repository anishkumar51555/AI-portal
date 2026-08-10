# ADR-002 — Modular monolith over microservices

- **Status:** Accepted
- **Date:** 2026-08-09
- **Related:** [`01-architecture.md §1, §4, §9`](../01-architecture.md#1-architectural-style)

## Context

"Enterprise-ready" is often read as "microservices". The portal has four plausible service
boundaries: catalog/discovery, publishing/validation, identity, and storage. It would be
easy to split them and easy to justify doing so on a slide.

Reality: one developer, 17 days, no traffic, and free-tier infrastructure that bills per
running service.

## Options considered

### A — Microservices (4 services + a gateway)

- ➕ Independent scaling and deployment
- ➕ Looks impressive on an architecture diagram
- ➖ 5 deployments, 5 pipelines, 5 sets of secrets
- ➖ Distributed transactions or eventual consistency for what is one local transaction
- ➖ Local development needs the whole constellation running
- ➖ Free tiers do not cover 5 always-on services
- ➖ A reviewer reads it as poor judgement, not ambition

### B — Modular monolith with enforced internal boundaries

- ➕ One deployable, one pipeline, one log stream
- ➕ Real ACID transactions where correctness needs them
- ➕ Boundaries enforced by lint rules, so they are real, not aspirational
- ➕ Extractable later — the seams are documented
- ➖ Everything scales together
- ➖ Boundaries erode without discipline

### C — Unstructured monolith

- ➕ Fastest to write
- ➖ Prisma calls in React components within two weeks; untestable; unextractable

## Decision

**Option B — modular monolith, with the dependency rule enforced by
`import/no-restricted-paths`.**

Decisive factor: the publish flow writes `Component`, `ComponentVersion`, `ComponentTag`,
`User.role`, and `AuditLog` **atomically**. In a monolith that is one `prisma.$transaction`.
Split across services it becomes a saga with compensating actions — an order of magnitude
more code and failure modes, for a system with no traffic.

The honest senior position is not "monolith vs microservices"; it is "start with a
monolith whose seams you can name". [`01 §9`](../01-architecture.md#9-where-the-seams-are-if-this-ever-needed-splitting)
names them, in extraction order.

## Consequences

**Positive**

- Correctness is cheap: real transactions, no eventual consistency to reason about.
- `docker compose up` + `npm run dev` is the entire local environment.
- Fits comfortably in free tiers.
- Answering "how would you scale this?" with a specific, ordered extraction plan is a
  stronger answer than having pre-split it.

**Negative**

- The whole app scales as one unit. Fine at this size; a real constraint later.
- Boundaries need active defence — hence the ESLint rule and
  [`.claude/rules/20-architecture-boundaries.md`](../../.claude/rules/20-architecture-boundaries.md).
- A single deploy can take everything down. Mitigated by smoke tests and instant rollback.

**Neutral**

- Services stay framework-agnostic (`server/services/` never imports `next/*`), which is
  precisely what keeps extraction cheap.

## Revisit when

Archive validation becomes CPU-bound enough to affect request latency for other users.
That is the first extraction: move `archive.inspector` behind a queue and make publish
asynchronous.
