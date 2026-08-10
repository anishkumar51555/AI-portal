# ADR-005 — Program against the S3 API, not against a vendor

- **Status:** Accepted
- **Date:** 2026-08-09
- **Related:** [`05-infrastructure.md §1, §4`](../05-infrastructure.md#1-strategy)

## Context

Archives must be stored somewhere durable. The problem statement suggests "AWS S3 or
similar". Constraints: ₹0 budget, local development must work offline, and the deployment
target may change.

## Options considered

### A — AWS S3 directly

- ➕ The reference implementation; matches the spec literally
- ➖ Requires an AWS account with a card on file; free tier expires after 12 months
- ➖ Egress is billed — a download-heavy registry is exactly the wrong shape for S3 pricing
- ➖ Local development needs either real S3 or a mock

### B — Local filesystem

- ➕ Trivially simple
- ➖ Vercel's filesystem is ephemeral and read-only — this does not work in production at all
- ➖ Non-starter

### C — Vendor-neutral S3 API: MinIO locally, Cloudflare R2 in production

- ➕ One SDK, one code path, four env vars separate the two
- ➕ MinIO is a container: offline development, fast tests, real presigned URLs
- ➕ R2 free tier is 10 GB with **zero egress fees**
- ➕ Portable to AWS S3, Azure Blob, Backblaze, or Wasabi without a code change
- ➖ Small behavioural differences (path-style vs virtual-host addressing)
- ➖ MinIO is one more container locally

## Decision

**Option C — `@aws-sdk/client-s3` against whatever endpoint the environment names.**

Decisive factor: **CI needs real storage.** With MinIO as a service container, integration
tests exercise genuine presign → PUT → head → copy → delete round trips. A mocked storage
layer would test the mock, and storage semantics — presigned URL conditions, copy
behaviour, key isolation — are exactly where the interesting bugs live.

The second factor is honesty about cost. A registry's dominant cost is egress. R2 charges
none. That is a real engineering decision with a real justification, not a preference.

## Consequences

**Positive**

- Local development is offline-capable and free.
- Integration tests run against real storage in CI.
- The word "R2" appears in exactly one file: `.env`.
- Provider migration is a configuration change, demonstrable in an interview by pointing
  at `storage.service.ts`.

**Negative**

- MinIO requires `forcePathStyle: true`; R2 and S3 do not. Handled by
  `S3_FORCE_PATH_STYLE`, and it is a documented day-1 gotcha.
- CORS must be configured separately on each provider, and a mistake produces an opaque
  browser error. Mitigation: configure it in Phase 0, long before it is needed.
- `S3_ENDPOINT` (what the server calls) and `S3_PUBLIC_ENDPOINT` (what the browser calls)
  can differ; both variables exist for that reason.

**Neutral**

- The abstraction is deliberately thin — a wrapper over the SDK, not a storage
  meta-framework. Wrapping it further would add indirection for no benefit.

## Revisit when

Storage exceeds R2's free tier, or a feature needs something outside the S3 API (image
transformation, event notifications).
