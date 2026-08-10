# Architecture Decision Records

A record of every significant decision: the context, the options considered, the choice,
and what it costs. Written at the time of the decision, never backfilled.

## Why these exist

Code shows _what_ was built. ADRs show _why_ — including the options that were rejected
and the price paid for the option chosen. That reasoning is the part an interviewer
actually wants and the part a codebase cannot express.

## Index

| #                                          | Decision                                            | Status                    | Date       |
| ------------------------------------------ | --------------------------------------------------- | ------------------------- | ---------- |
| [001](ADR-001-fullstack-framework.md)      | Next.js full-stack over MERN                        | Accepted                  | 2026-08-09 |
| [002](ADR-002-modular-monolith.md)         | Modular monolith over microservices                 | Accepted                  | 2026-08-09 |
| [003](ADR-003-postgres-and-prisma.md)      | PostgreSQL + Prisma over MongoDB + Mongoose         | Accepted                  | 2026-08-09 |
| [004](ADR-004-authentication.md)           | Auth.js v5 with GitHub OAuth                        | Accepted                  | 2026-08-09 |
| [005](ADR-005-storage-abstraction.md)      | S3-compatible storage abstraction                   | Accepted                  | 2026-08-09 |
| [006](ADR-006-manifest-specification.md)   | A formal, enforced manifest specification           | Accepted                  | 2026-08-09 |
| [007](ADR-007-versioning-model.md)         | Immutable versions in a separate table              | Accepted                  | 2026-08-09 |
| [008](ADR-008-postgres-fulltext-search.md) | Postgres full-text search over a search engine      | Accepted                  | 2026-08-09 |
| [009](ADR-009-toolchain-versions.md)       | Pinning bleeding-edge toolchain versions            | Accepted (strategy)       | 2026-08-09 |
| [010](ADR-010-two-phase-upload.md)         | Two-phase presigned upload                          | Accepted                  | 2026-08-09 |
| [011](ADR-011-toolchain-outcome.md)        | **Toolchain gate result — TS 6.0.3, ESLint 9.39.5** | Accepted (supersedes 009) | 2026-08-09 |

## Rules

1. One decision per record. If it needs "and also", it is two ADRs.
2. Numbers are permanent. Never renumber, never reuse.
3. An accepted ADR is **immutable**. To change a decision, write a new ADR that supersedes
   it and mark the old one `Superseded by ADR-0NN`.
4. Record the **consequences**, especially the negative ones. An ADR with no downsides
   listed is marketing, not engineering.
5. Write it when you decide, not when you document. A backfilled ADR reads like one.

Template: [ADR-000-template.md](ADR-000-template.md)
