# AI Component Ecosystem Portal — Documentation

A centralized developer hub for discovering, publishing, and bootstrapping modular AI
components: **Skills**, **Plugins**, **Agents**, and **MCP Gateways**.

> **Status:** Planning complete. Implementation not started.
> **Owner:** Anish Kumar
> **Plan date:** 2026-08-09
> **Target delivery:** 2–3 week sprint (~17 working days)

---

## Read in this order

| #   | Document                                                 | What it answers                                                 | Read when                     |
| --- | -------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------- |
| 00  | [Overview & Scope](00-overview.md)                       | What are we building, and _not_ building?                       | First. Always.                |
| 01  | [Architecture](01-architecture.md)                       | What are the moving parts and why?                              | Before any code.              |
| 02  | [Data Model](02-data-model.md)                           | What does the database look like?                               | Phase 2.                      |
| 03  | [API Contract](03-api-contract.md)                       | Every endpoint, request, response, error.                       | Phase 2–4.                    |
| 04  | [Sequence Flows](04-sequence-flows.md)                   | End-to-end runtime behaviour, diagrammed.                       | Before implementing any flow. |
| 05  | [Infrastructure](05-infrastructure.md)                   | Docker, environments, cloud topology.                           | Phase 0 and Phase 5.          |
| 06  | [Component Manifest Spec](06-component-manifest-spec.md) | The `component.json` contract. **The core IP of this project.** | Phase 3.                      |
| 07  | [Template Catalog](07-template-catalog.md)               | What's inside the four boilerplates.                            | Phase 2.                      |
| 08  | [Security Model](08-security-model.md)                   | AuthN/AuthZ, upload safety, threat table.                       | Phase 1 and Phase 3.          |
| 09  | **[Implementation Plan](09-implementation-plan.md)**     | **The day-by-day build order. Start here to code.**             | Every day.                    |
| 10  | [CI/CD & Deployment](10-cicd-and-deployment.md)          | GitHub Actions + Azure DevOps + release.                        | Phase 5.                      |
| 11  | [Testing Strategy](11-testing-strategy.md)               | What to test, how much, with what.                              | Continuously.                 |
| 12  | [Enterprise Standards](12-enterprise-standards.md)       | The practices that make this look senior.                       | Skim now, apply throughout.   |
| 13  | [Feature Test Matrix](13-feature-test-matrix.md)         | Which features actually have tests, and how to close a gap.     | After building anything.      |

### ⚡ Read this before reading anything above

**[`CONTEXT-MAP.md`](CONTEXT-MAP.md)** — this set is ~36,000 words. Reading it all costs
~48,000 tokens and leaves no room for the actual work. The context map tells you the
exact sections each kind of task needs, usually one row and under 3,000 words. Combined
with [`../PROJECT-STATE.md`](../PROJECT-STATE.md) it is how a new session gets oriented
cheaply.

### Supporting material

- [`adr/`](adr/) — Architecture Decision Records. _Why_ each significant choice was made.
- [`appendix/interview-talking-points.md`](appendix/interview-talking-points.md) — How to talk about this project in an interview.
- [`appendix/learning-path.md`](appendix/learning-path.md) — What to learn, in what order, coming from MERN.

---

## The one-paragraph version

A Next.js 16 full-stack application backed by PostgreSQL and S3-compatible object
storage. Authenticated developers download validated boilerplate templates for four
AI-component types, build against a published `component.json` manifest specification,
and publish their work back as versioned, immutable release archives. Every upload is
validated server-side against a Zod schema and screened for archive-level attacks before
it enters the catalog. Other developers discover components through a full-text-searchable
catalog and download them via short-lived presigned URLs. The whole system runs locally
under Docker Compose and deploys to free-tier cloud infrastructure through a CI/CD
pipeline defined in both GitHub Actions and Azure DevOps.

---

## Quick reference

**Stack:** Next.js 16 (App Router) · TypeScript 7 · PostgreSQL 16 · Prisma 7 ·
Auth.js v5 (GitHub OAuth) · Tailwind CSS 4 + shadcn/ui · Zod 4 · S3-compatible storage
(MinIO local / Cloudflare R2 prod) · Docker · GitHub Actions + Azure DevOps

**Four component types:** `SKILL` · `PLUGIN` · `AGENT` · `MCP_GATEWAY`

**Four core deliverables** (from the problem statement):

1. Standardized template provisioning → [07](07-template-catalog.md)
2. Publishing & onboarding engine → [06](06-component-manifest-spec.md), [04](04-sequence-flows.md#flow-3--component-publishing)
3. Discovery & catalog UI → [04](04-sequence-flows.md#flow-4--discovery--download)
4. Access & consumption (auth + download) → [08](08-security-model.md)

---

## Conventions used in these docs

- **MUST / SHOULD / MAY** carry [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) meanings.
  MUST is a hard requirement; SHOULD is a strong default you may deviate from with a
  recorded reason; MAY is optional.
- Diagrams are [Mermaid](https://mermaid.js.org/) fenced blocks. They render on GitHub,
  in VS Code with the Markdown Preview Mermaid extension, and in the published Artifact.
- `‹placeholder›` marks a value you fill in.
- **Flagged assumption** callouts mark decisions made on your behalf that you should
  confirm or override.
