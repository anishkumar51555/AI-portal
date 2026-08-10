# ADR-001 — Next.js full-stack over a MERN split

- **Status:** Accepted
- **Date:** 2026-08-09
- **Related:** [`01-architecture.md §7`](../01-architecture.md#7-technology-choices-with-the-version-pinned)

## Context

The portal needs a marketing surface, a searchable catalog, an authenticated dashboard,
an upload wizard, and a REST API. Constraints: one developer, ~17 working days, a MERN
background (React + Node, no Next.js, no TypeScript in anger), and ₹0 budget.

The problem statement recommends "a modern, type-safe framework (e.g. Next.js with
TypeScript)" but leaves the choice open.

## Options considered

### A — MERN: Express API + separate React SPA + MongoDB

- ➕ The stack I already know; zero learning curve
- ➖ Two deployables, two build pipelines, two hosting configs
- ➖ CORS, and hand-rolled session/JWT handling
- ➖ Client-rendered catalog is invisible to search engines
- ➖ Types duplicated across the boundary and free to drift
- ➖ The lowest-differentiation stack in the current job market

### B — Next.js App Router, full-stack, TypeScript

- ➕ One codebase, one deployment, no CORS
- ➕ Server Components render the catalog on the server: fast and indexable
- ➕ Types shared end-to-end; a schema change breaks the build, not production
- ➕ The framework the spec recommends
- ➖ Genuinely new: RSC, App Router, and TypeScript all at once
- ➖ Server/client boundary confusion is the classic beginner trap

### C — Next.js frontend + a separate NestJS API

- ➕ Clean separation; NestJS is enterprise-idiomatic
- ➖ Two deployables again, for a project with one developer
- ➖ Two frameworks to learn instead of one

## Decision

**Option B — Next.js 16 App Router with TypeScript.**

Decisive factor: **the learning cost is the point.** Option A finishes faster and teaches
nothing; the completed project would be indistinguishable from thousands of other student
MERN apps. Option B costs roughly three days of learning curve and produces something that
demonstrably moves the needle in interviews.

Option C's separation is real but unaffordable — every hour spent on inter-service
plumbing is an hour not spent on the manifest validator, which is what actually makes this
project interesting.

## Consequences

**Positive**

- One `npm run dev`, one deploy, one log stream.
- Server Components mean the catalog is SEO-visible with no extra work.
- TypeScript across the API boundary eliminates a whole class of bugs.
- Vercel deployment is effectively free and zero-config.

**Negative**

- Days 1–4 will be slower than they would be in Express. Budgeted for.
- The `"use client"` boundary is easy to get wrong; the mitigation is the explicit
  rendering-strategy table in [`01 §6`](../01-architecture.md#6-rendering-strategy).
- Vercel's 4.5 MB body limit forced the presigned-upload design (see
  [ADR-010](ADR-010-two-phase-upload.md)) — which turned out to be the better architecture
  anyway.
- Some vendor gravity toward Vercel. Mitigated by the Dockerfile: the same image runs
  anywhere.

**Neutral**

- MERN experience still transfers — React, npm, and async Node are unchanged.

## Revisit when

The API needs to serve consumers other than this web app (a CLI, a third-party
integration) at a volume where its deployment cadence should differ from the UI's. Extract
the API then, not before.
