# ADR-004 — Auth.js v5 with GitHub OAuth

- **Status:** Accepted
- **Date:** 2026-08-09
- **Related:** [`08-security-model.md §2`](../08-security-model.md#2-authentication--authorization), [`04-sequence-flows.md Flow 1`](../04-sequence-flows.md#flow-1--authentication-github-oauth--rbac)

## Context

Deliverable #4 requires secure authentication so users can log in, browse, download, and
publish. Three roles are needed. This is a **developer** registry, so the audience already
has GitHub accounts.

## Options considered

### A — Auth.js v5 (next-auth) + GitHub OAuth

- ➕ Free, self-hosted, no vendor lock
- ➕ OAuth done correctly out of the box: PKCE, `state`, secure cookie defaults
- ➕ No passwords to store, hash, reset, or leak
- ➕ GitHub login is the correct idiom for a developer registry, and it supplies a
  verified publisher identity for free
- ➕ Prisma adapter matches the chosen data layer
- ➖ **Still tagged `beta` (5.0.0-beta.32)**
- ➖ v4 tutorials outnumber v5 tutorials and will actively mislead

### B — Self-built email + password

- ➕ Total control; deep learning about session security
- ➖ Argon2 hashing, verification email, reset flow, timing-attack care, breach exposure
- ➖ Needs an email provider
- ➖ Roughly 2 extra days for a _worse_ user experience in this audience

### C — Clerk / Auth0

- ➕ Fastest; polished; MFA and SSO included
- ➖ Paid past the free tier
- ➖ Teaches nothing about OAuth
- ➖ A hosted auth vendor in a portfolio project invites "so what did _you_ build?"

## Decision

**Option A — Auth.js v5 with GitHub OAuth only, and JWT sessions.**

Decisive factor: **the audience is developers.** Every user already has a GitHub account,
and GitHub identity doubles as publisher attribution — `githubLogin` on a component card
is real provenance, not a self-declared display name. Password auth would be more work for
a worse result.

Sub-decision — **JWT sessions rather than database sessions**: avoids a session SELECT on
every request and keeps middleware edge-compatible. The cost is that a role change takes
effect on the next token refresh. Mitigated by re-reading the role from the database for
privileged operations ([`08 §2.2`](../08-security-model.md#22-authorization--rbac)).

## Consequences

**Positive**

- No password storage: an entire vulnerability class does not exist here.
- Sign-in is two clicks.
- Publisher identity is verifiable against a real GitHub profile.
- `USER → PUBLISHER → ADMIN` fits naturally on the JWT.

**Negative**

- **Beta dependency.** Mitigation: pin the exact version, no caret. Fallback to
  `next-auth@4.24.15` costs ~0.5 day, and the guard functions in `server/auth/guards.ts`
  are the only place the session shape is read — so the blast radius is one file.
- No login without a GitHub account. Acceptable for this audience; a Credentials provider
  is an additive change.
- Role changes lag by up to the token lifetime for non-privileged checks.
- Two OAuth apps are required (dev and production) because a callback URL is per-app.

**Neutral**

- The `Account` table stores OAuth tokens, enabling future GitHub API features
  (importing a repo README, verifying repository ownership).

## Revisit when

Auth.js v5 reaches stable — bump the pin and delete this caveat. Or: organizations and SSO
become requirements, at which point a dedicated IdP (Keycloak, Entra ID) replaces it and
only `server/auth/` changes.
