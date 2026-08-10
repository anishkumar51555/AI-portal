# Rule 50 — Security

Full model: [`docs/08-security-model.md`](../../docs/08-security-model.md). This file is
the enforceable subset.

## Authorization

- **Every** Route Handler, Server Action, and protected Server Component calls a guard
  from `src/server/auth/guards.ts` — `requireAuth`, `requireRole`, or `requireOwnership`.
- **Middleware is not a security boundary.** It checks cookie _presence_ for a redirect.
  A direct `fetch` bypasses it entirely. Never treat a middleware check as sufficient.
- For `ADMIN`-only destructive operations, re-read the role from the database. The JWT can
  be stale after a demotion.
- `requireOwnership` returns **404**, not 403, for a resource that exists but is not the
  caller's. A 403 is an enumeration oracle.

## Object storage

1. **The client never supplies an object key.** The server derives every key:
   `staging/{userId}/{ulid}.zip`, `components/{slug}/{version}/{slug}-{version}.zip`.
2. Before touching a staging object, assert `stagingKey.startsWith(\`staging/${user.id}/\`)`.
   This is the multi-tenant isolation boundary — check it before any storage call.
3. The bucket is **private**. Every read is a presigned GET with a ≤300 s TTL.
4. Presigned uploads carry a `content-length-range` condition so storage enforces the size
   limit itself. Never rely on the client.
5. Delete the staging object on **both** the success and the rejection path.

## Upload inspection — never skip a guard

`archive.inspector` must enforce all of these, aborting on the first breach:

| Guard                         | Limit    |
| ----------------------------- | -------- |
| Entry count                   | ≤ 1000   |
| Total uncompressed            | ≤ 50 MB  |
| Per-entry compression ratio   | ≤ 100:1  |
| Absolute paths (`/…`, `C:\…`) | rejected |
| `..` path segments            | rejected |
| Symlink entries               | rejected |

It must be **streaming**. Never buffer a whole archive; never fully decompress a suspected
bomb to measure it.

## Rendering user content

- **`dangerouslySetInnerHTML` is banned.** No exceptions.
- Markdown renders through `react-markdown` + `rehype-sanitize`, with raw HTML disabled.
- Manifest URLs (`homepage`, `repository`, `author.url`) are `https://` only — the schema
  enforces it. This closes `javascript:` XSS.
- Never render a manifest value into an attribute without escaping.

## Secrets

- Secrets live in env vars, validated by `src/lib/env.ts` at boot.
- Only `NEXT_PUBLIC_*` may reach the browser. Importing a server env value into a Client
  Component bundles it — this is how S3 keys leak.
- Never log a token, secret, password, raw IP, or full request body.
- Never echo a detected secret back in an error message. Name the _pattern_, not the value.
- `.env*` is gitignored except `.env.example`, which contains names only.

## Error responses

A 500 body contains a generic message and a `requestId`. Never a stack trace, SQL
fragment, file path, or exception message. Log the detail server-side against that id.

## Before you write code that…

| …does this              | Read first                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------- |
| Accepts a file          | [`docs/08 §4`](../../docs/08-security-model.md#4-upload-pipeline-threats)           |
| Reads a session         | [`docs/08 §2`](../../docs/08-security-model.md#2-authentication--authorization)     |
| Renders user text       | [`docs/08 §4`](../../docs/08-security-model.md#4-upload-pipeline-threats) rows 9–10 |
| Generates a storage key | [`docs/05 §4`](../../docs/05-infrastructure.md#4-object-storage-layout)             |
| Adds a header           | [`docs/08 §6`](../../docs/08-security-model.md#6-security-headers)                  |

## When you spot a security issue outside your task

Say so. Do not silently fix it in an unrelated commit, and do not ignore it.
