# ADR-010 — Two-phase presigned upload with staged validation

- **Status:** Accepted
- **Date:** 2026-08-09
- **Related:** [`01-architecture.md §5.1–5.2`](../01-architecture.md#51-uploads-and-downloads-bypass-the-application-server), [`04-sequence-flows.md Flow 3`](../04-sequence-flows.md#flow-3--component-publishing)

## Context

Users upload archives up to 10 MB. Every archive must be validated — safety guards plus
manifest schema — before it becomes visible. Production runs on Vercel serverless
functions.

Two hard constraints:

1. **Vercel caps serverless request bodies at 4.5 MB.** A 10 MB multipart POST to a Route
   Handler fails in production, regardless of any application-level configuration.
2. Buffering multi-MB uploads in a memory-limited function is an OOM under concurrency.

## Options considered

### A — Multipart POST through the application, validate in memory, then store

- ➕ One request; simplest client
- ➖ **Breaks in production above 4.5 MB.** Disqualifying on its own.
- ➖ Memory pressure; bytes traverse the network twice (client→app→storage)

### B — Presigned PUT direct to storage, validate on a webhook

- ➕ No size limit; bytes go once
- ➖ Requires storage event notifications, which R2's free tier does not usefully provide
- ➖ Asynchronous: the user gets no immediate verdict, which ruins the demo

### C — Two-phase: presign → direct PUT to a staging prefix → separate publish call that

validates and promotes

- ➕ No body-size limit; bytes traverse once
- ➕ Validation is synchronous, so the user gets an immediate, precise verdict
- ➕ Staging isolates unvalidated content from the catalog completely
- ➕ Works identically against MinIO and R2
- ➖ Two round trips; a more complex client
- ➖ Storage write and DB write are not one atomic operation
- ➖ Abandoned uploads need cleanup

## Decision

**Option C.** The client requests a presigned upload for a **server-derived** key
`staging/{userId}/{ulid}.zip`, PUTs directly to storage, then calls
`POST /api/components` with the staging key. The server validates and, on success,
`CopyObject`s to the permanent key and commits the database transaction.

Decisive factor: **constraint 1 eliminates option A outright, and the synchronous verdict
eliminates option B.** Option C is the only design satisfying both. It also happens to be
the correct architecture independent of Vercel — the app becomes a control plane and
storage the data plane.

Three sub-decisions carry most of the safety:

1. **The client never chooses the key.** A client-supplied key is a bucket-wide write
   primitive; a crafted value could overwrite an official template.
2. **`stagingKey` MUST start with `staging/{callerId}/`**, checked before any storage
   call. This is the multi-tenant isolation boundary.
3. **Promote storage _before_ committing the DB.** A crash between them leaves an orphaned
   object (wasted bytes, invisible, harmless) rather than a catalog row pointing at a
   missing file (a user-visible 404). Always fail toward the harmless side.

## Consequences

**Positive**

- Works within every platform limit; no bytes through the app server.
- The user sees `MANIFEST_INVALID` with field-level detail within ~2 s.
- Unvalidated content is never catalog-reachable.
- A real upload progress bar is possible (via `XMLHttpRequest` on the PUT).
- The same flow works locally against MinIO, so it is fully testable.

**Negative**

- The client is a state machine (see
  [`04 Flow 3`](../04-sequence-flows.md#client-side-wizard-states)) rather than one form
  POST.
- Not atomic across storage and database. Mitigated by ordering; a reconciliation sweep is
  a v2 nicety, not a v1 requirement.
- Abandoned staging objects accumulate. Mitigated by a 24-hour lifecycle rule — and the
  server also deletes on both the success and rejection paths, so the rule is a backstop,
  not the mechanism.
- Direct browser→storage upload requires CORS on the bucket, which is a classic
  hard-to-diagnose failure. Configured in Phase 0 deliberately, long before it is used.

**Neutral**

- Retrying with the same staging key after a network failure is safe and reuses the
  already-uploaded bytes.

## Revisit when

Archives need to exceed ~100 MB (switch to S3 multipart upload), or validation grows slow
enough to exceed the function timeout (move to option B with a queue and a `PENDING`
status).
