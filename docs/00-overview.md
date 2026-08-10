# 00 — Overview, Scope & Glossary

## 1. Problem restated

Teams building agentic applications keep re-inventing the same four building blocks —
Skills, Plugins, Agents, and MCP Gateways — because there is no shared place to find,
standardize, or publish them. Three concrete symptoms:

| Symptom                  | Consequence                                                                           | What the portal does about it                                                        |
| ------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| No canonical boilerplate | Every team invents its own folder layout, config format, and entrypoint convention    | Ships four opinionated, downloadable templates that all conform to one manifest spec |
| No shared registry       | Useful components live in private repos and Slack threads; discovery is word-of-mouth | Provides a searchable, tagged, categorized public catalog                            |
| No structural contract   | Components can't be validated, compared, or tooled against                            | Defines and **enforces** `component.json` at publish time                            |

The third row is the load-bearing one. A registry without a validated schema is a file
host. A registry _with_ one is a platform — it can validate, index, diff, and eventually
automate. That is why the manifest specification is treated as the project's core IP and
gets its own document ([06](06-component-manifest-spec.md)).

## 2. Goals

**G1 — Standardized template provisioning.** Any authenticated user can download a
ready-to-run boilerplate for any of the four component types. Each template is itself a
valid, publishable component: unzip it, edit it, publish it back. _That round trip is the
product._

**G2 — Publishing & onboarding engine.** Users upload a `.zip` archive. The server
validates it — structurally, schematically, and for archive-level safety — before it is
ever visible to anyone else. Invalid uploads produce precise, field-level error messages.

**G3 — Discovery & catalog UI.** A catalog with full-text search, filtering by type and
tag, sorting, and pagination. Detail pages render the component README, manifest,
version history, and download button.

**G4 — Access & consumption.** GitHub OAuth login. Role-based access control
(`USER` / `PUBLISHER` / `ADMIN`). Downloads served through short-lived presigned URLs;
the storage bucket is never publicly readable.

**G5 — Engineering maturity.** Containerized, CI/CD-automated, documented with ADRs,
tested at the right altitude, and deployable by someone who is not you.

## 3. Non-goals — explicitly out of scope for v1

Naming these protects the sprint. Each is a legitimate feature; none is needed to
demonstrate the thesis.

| Non-goal                                                     | Why it's out                                                                                                                           | Where it would go                     |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Executing or sandboxing uploaded components                  | Running untrusted code needs isolation infrastructure far beyond a 3-week budget. The portal **distributes**, it does not **execute**. | v2, with gVisor/Firecracker           |
| Live dependency resolution (`npm`-style transitive installs) | Requires a resolver, lockfile format, and CDN                                                                                          | v2                                    |
| Organizations, teams, private components                     | Multiplies the permission matrix; single-owner is sufficient to prove RBAC                                                             | v2                                    |
| Payments / paid components                                   | No revenue requirement                                                                                                                 | Never                                 |
| Federated or mirrored registries                             | Distributed-systems complexity with no demo value                                                                                      | Never                                 |
| Ratings, reviews, comments                                   | Needs moderation and anti-abuse to be honest                                                                                           | v2                                    |
| Full moderation workflow                                     | Publish is immediate in v1; `ADMIN` can suspend after the fact                                                                         | Partially in v1 (suspend), full in v2 |
| Companion CLI (`npx create-ai-component`)                    | Deferred by your scoping decision — the API is designed so it drops in later without server changes                                    | v2                                    |
| Automated malware scanning of archive _contents_             | Deferred by your scoping decision                                                                                                      | v2                                    |
| Semantic-version range resolution (`^1.2.0`)                 | Versions are stored and listed; range _resolution_ is a client concern                                                                 | v2                                    |

> **Flagged assumption — upload safety is not optional.** You deselected "upload security
> scanning" as a differentiator, and full content scanning is correctly out of scope. But
> archive-level guards — zip-slip path traversal, decompression bombs, entry-count limits,
> symlink rejection — are **kept in the v1 core**, not as a differentiator but as baseline
> correctness. A registry that redistributes archives without them is a vulnerability
> being hosted, and it is roughly 80 lines of code. See
> [08 §4](08-security-model.md#4-upload-pipeline-threats). Tell me if you want these
> dropped; I'd argue strongly against it.

## 4. Personas

| Persona                                         | Wants                                              | Key journey                                               |
| ----------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------- |
| **Consumer** — dev integrating AI features      | To find a working MCP gateway without writing one  | Login → search catalog → read detail page → download zip  |
| **Producer** — dev who built something reusable | To share it and be credited                        | Login → download template → build → publish → see it live |
| **Maintainer** — the producer, later            | To ship v1.1.0 without breaking v1.0.0 consumers   | Dashboard → new version → upload → both versions listed   |
| **Admin** — you, operating the platform         | To remove abusive content and see what's happening | Admin view → suspend component; audit log                 |

## 5. Success criteria

The project is done when a person who has never seen it can, unaided:

1. Clone the repo, run `docker compose up` and `npm run dev`, and reach a working app
   in under 10 minutes using only [`05-infrastructure.md`](05-infrastructure.md).
2. Log in with GitHub.
3. Download the MCP Gateway template.
4. Edit `component.json`, re-zip, and publish it successfully.
5. Deliberately break the manifest, attempt to publish, and receive a precise
   field-level error naming the offending path.
6. Find the published component via catalog search and download it.
7. Open a live deployed URL and repeat steps 2–6 there.

Criterion 5 is the one that distinguishes this project from a CRUD app. Demo it first.

## 6. Glossary

| Term                           | Meaning in this project                                                                                               |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| **Component**                  | Any publishable unit. Always exactly one of the four types.                                                           |
| **Skill**                      | A packaged capability — instructions plus optional scripts — that an agent loads to perform a task.                   |
| **Plugin**                     | An extension bundle that hooks into a host application's lifecycle (commands, event hooks).                           |
| **Agent**                      | A configured autonomous loop: system prompt, model, tool list, iteration budget.                                      |
| **MCP Gateway**                | A [Model Context Protocol](https://modelcontextprotocol.io) server exposing tools/resources over stdio, HTTP, or SSE. |
| **Manifest**                   | `component.json` at the archive root. The machine-readable contract. See [06](06-component-manifest-spec.md).         |
| **Template**                   | A portal-authored starter archive for one component type. Itself manifest-valid.                                      |
| **Version**                    | An immutable published release of a component. `(component, version)` is unique forever.                              |
| **Artifact / Release archive** | The `.zip` stored in object storage for one version.                                                                  |
| **Staging key**                | Temporary object-storage path holding an upload _before_ validation. Auto-expires in 24h.                             |
| **Object key**                 | Permanent storage path for a validated release archive.                                                               |
| **Presigned URL**              | Time-limited, signed URL granting one operation on one object without credentials.                                    |
| **Slug**                       | URL-safe unique component identifier, e.g. `pdf-extractor`.                                                           |
| **RBAC**                       | Role-based access control: `USER`, `PUBLISHER`, `ADMIN`.                                                              |

## 7. Constraints shaping every decision

- **Budget: ₹0.** Every service must have a genuinely free tier with no card-on-file
  surprise. This rules out RDS, ECS Fargate, and Azure App Service as the _primary_
  target.
- **Time: ~17 working days**, part-time, alongside job hunting.
- **Skill: MERN-adjacent.** React and Node fundamentals are present; Next.js App Router,
  TypeScript, Prisma, and Docker are new. The plan front-loads the unfamiliar pieces so
  surprises land in week 1, not week 3.
- **Solo.** No code review partner, so the CI pipeline and `.claude/rules/` act as the
  reviewer.
- **Windows 11 development host.** All commands in the docs are PowerShell-compatible;
  the container images are Linux.
