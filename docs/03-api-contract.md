# 03 — API Contract

Every HTTP endpoint the portal exposes. Implement exactly this; if the shape needs to
change, change this document in the same commit.

## 1. Conventions

- Base path: `/api`. All responses are `application/json` unless stated.
- All request bodies and query strings are parsed with a Zod schema from
  `src/domain/schemas/`. **A handler that does not start with a Zod parse is a bug.**
- Every response carries `X-Request-Id` (a ULID, generated in middleware, present on every
  log line for that request).
- Timestamps are ISO 8601 UTC.
- Pagination is `page` (1-based) + `pageSize` (default 20, max 100).

### 1.1 Error envelope — every non-2xx response

```jsonc
{
  "error": {
    "code": "MANIFEST_INVALID", // stable, machine-readable, SCREAMING_SNAKE
    "message": "Manifest failed validation.", // human-readable, safe to display
    "details": [
      // optional; field-level, present on 400/422
      { "path": "type", "message": "Expected one of: skill, plugin, agent, mcp-gateway" },
      { "path": "runtime.language", "message": "Required" },
    ],
  },
  "requestId": "01JQ8Z3K7M9V2XW4N6P8R0T2Y5",
}
```

`details[].path` uses dot/bracket notation matching the Zod issue path
(`tools[0].name`), so the upload wizard can highlight the exact offending field.

### 1.2 Error code taxonomy

| Code                     | HTTP | Meaning                                                            |
| ------------------------ | ---- | ------------------------------------------------------------------ |
| `UNAUTHENTICATED`        | 401  | No valid session                                                   |
| `FORBIDDEN`              | 403  | Authenticated but lacks role or ownership                          |
| `NOT_FOUND`              | 404  | Resource absent, or hidden from this caller                        |
| `VALIDATION_ERROR`       | 400  | Request body/query failed Zod parse                                |
| `SLUG_TAKEN`             | 409  | Component slug already exists                                      |
| `VERSION_EXISTS`         | 409  | That `(component, version)` is already published                   |
| `VERSION_NOT_INCREASING` | 409  | New version does not sort above the current latest                 |
| `DUPLICATE_ARCHIVE`      | 409  | Identical SHA-256 already published                                |
| `MANIFEST_MISSING`       | 422  | No `component.json` at archive root                                |
| `MANIFEST_INVALID`       | 422  | Manifest failed schema validation                                  |
| `ARCHIVE_INVALID`        | 422  | Not a readable zip                                                 |
| `ARCHIVE_UNSAFE`         | 422  | Path traversal, symlink, or bomb ratio detected                    |
| `ARCHIVE_TOO_LARGE`      | 413  | Exceeds compressed or uncompressed limit                           |
| `STAGING_NOT_FOUND`      | 404  | Staging key absent or expired                                      |
| `STAGING_FORBIDDEN`      | 403  | Staging key does not belong to the caller                          |
| `RATE_LIMITED`           | 429  | Too many requests; includes `Retry-After`                          |
| `INTERNAL_ERROR`         | 500  | Unexpected. `message` is always generic; detail goes to logs only. |

> **Rule:** a 500 response body MUST NOT contain a stack trace, SQL fragment, file path,
> or exception message. Log the detail with the `requestId`; return the id to the user.

### 1.3 Auth requirements notation

| Mark | Requirement                       |
| ---- | --------------------------------- |
| —    | Public                            |
| 🔒   | Any authenticated user            |
| 🔑   | Owner of the resource, or `ADMIN` |
| 👑   | `ADMIN` only                      |

## 2. Endpoint index

| Method     | Path                                               | Auth | Purpose                             |
| ---------- | -------------------------------------------------- | ---- | ----------------------------------- |
| `GET/POST` | `/api/auth/[...nextauth]`                          | —    | Auth.js handlers                    |
| `GET`      | `/api/health`                                      | —    | Liveness + readiness                |
| `GET`      | `/api/schemas/component-v1.json`                   | —    | Public JSON Schema for the manifest |
| `GET`      | `/api/templates`                                   | —    | List the four templates             |
| `GET`      | `/api/templates/:type/download`                    | 🔒   | 302 → presigned GET                 |
| `GET`      | `/api/components`                                  | —    | Catalog search                      |
| `GET`      | `/api/components/:slug`                            | —    | Component detail                    |
| `POST`     | `/api/components`                                  | 🔒   | Publish a **new** component         |
| `PATCH`    | `/api/components/:slug`                            | 🔑   | Update mutable metadata             |
| `DELETE`   | `/api/components/:slug`                            | 🔑   | Soft delete                         |
| `GET`      | `/api/components/:slug/versions`                   | —    | Version history                     |
| `POST`     | `/api/components/:slug/versions`                   | 🔑   | Publish a **new version**           |
| `GET`      | `/api/components/:slug/versions/:version/download` | 🔒   | 302 → presigned GET                 |
| `POST`     | `/api/uploads/presign`                             | 🔒   | Mint a presigned PUT                |
| `GET`      | `/api/me`                                          | 🔒   | Current user + role                 |
| `GET`      | `/api/me/components`                               | 🔒   | Caller's components                 |
| `GET`      | `/api/tags`                                        | —    | Tag list with counts                |
| `POST`     | `/api/admin/components/:slug/suspend`              | 👑   | Suspend / unsuspend                 |

---

## 3. Endpoints

### 3.1 `GET /api/health` —

Two modes so orchestrators can distinguish "process alive" from "can serve traffic".

`GET /api/health` → shallow, always fast:

```json
{ "status": "ok", "version": "0.4.1", "commit": "a1b2c3d", "uptimeSec": 4821 }
```

`GET /api/health?deep=1` → checks dependencies (used by CI smoke tests, not by the
container healthcheck):

```json
{
  "status": "ok",
  "checks": {
    "database": { "status": "ok", "latencyMs": 12 },
    "storage": { "status": "ok", "latencyMs": 38 }
  }
}
```

Returns **503** with `"status": "degraded"` if any check fails.

---

### 3.2 `GET /api/templates` —

```json
{
  "data": [
    {
      "type": "SKILL",
      "name": "Skill Starter",
      "description": "Minimal Skill with instructions, tool allowlist, and a test harness.",
      "version": "1.0.0",
      "sizeBytes": 14208,
      "checksumSha256": "9f2c…",
      "downloadCount": 42,
      "docsUrl": "/docs/templates#skill",
      "downloadUrl": "/api/templates/skill/download"
    }
    // …PLUGIN, AGENT, MCP_GATEWAY
  ]
}
```

### 3.3 `GET /api/templates/:type/download` 🔒

`:type` ∈ `skill | plugin | agent | mcp-gateway` (kebab-case in URLs; the enum is
SCREAMING_SNAKE internally — convert at the edge).

1. Require session → else 401.
2. Look up the `Template` row → else 404.
3. Insert a `Download` row (`kind: TEMPLATE`, hashed IP) and increment `downloadCount`.
4. **302** redirect to a presigned GET, TTL **300 s**, with
   `response-content-disposition: attachment; filename="skill-template-1.0.0.zip"`.

> Redirecting rather than proxying means the archive bytes never touch the app server —
> consistent with [01 §5.1](01-architecture.md#51-uploads-and-downloads-bypass-the-application-server).

---

### 3.4 `GET /api/components` — (catalog search)

**Query parameters**

| Param      | Type              | Default     | Notes                                                 |
| ---------- | ----------------- | ----------- | ----------------------------------------------------- |
| `q`        | string ≤ 200      | —           | Full-text query, passed to `websearch_to_tsquery`     |
| `type`     | enum, repeatable  | all         | `skill \| plugin \| agent \| mcp-gateway`             |
| `tags`     | csv of slugs ≤ 10 | —           | AND semantics                                         |
| `sort`     | enum              | `relevance` | `relevance \| downloads \| newest \| updated \| name` |
| `page`     | int ≥ 1           | 1           |                                                       |
| `pageSize` | int 1–100         | 20          |                                                       |

When `q` is absent, `sort=relevance` falls back to `downloads`.

**200**

```jsonc
{
  "data": [
    {
      "slug": "pdf-extractor",
      "displayName": "PDF Extractor",
      "type": "SKILL",
      "summary": "Extracts structured text and tables from PDF documents.",
      "latestVersion": "1.2.0",
      "downloadCount": 341,
      "tags": ["pdf", "data-extraction"],
      "owner": { "githubLogin": "anish-k", "image": "https://…" },
      "updatedAt": "2026-08-01T10:22:31.000Z",
    },
  ],
  "pagination": { "page": 1, "pageSize": 20, "total": 137, "totalPages": 7 },
  "facets": {
    "types": [
      { "type": "SKILL", "count": 61 },
      { "type": "MCP_GATEWAY", "count": 34 },
    ],
    "tags": [{ "slug": "pdf", "label": "PDF", "count": 12 }],
  },
}
```

`facets` powers the sidebar filter counts. Compute it with a second grouped query
constrained by the same `WHERE` clause minus the facet being counted; run both queries
inside one `prisma.$transaction([...])` so counts and rows agree.

Only `status = PUBLISHED | DEPRECATED` and `deletedAt IS NULL` are ever returned.
`SUSPENDED` components are invisible to everyone except an `ADMIN`.

---

### 3.5 `GET /api/components/:slug` —

**200**

```jsonc
{
  "data": {
    "slug": "pdf-extractor",
    "displayName": "PDF Extractor",
    "name": "pdf-extractor",
    "type": "SKILL",
    "summary": "Extracts structured text and tables from PDF documents.",
    "readme": "# PDF Extractor\n\n…", // raw markdown; sanitize at render
    "status": "PUBLISHED",
    "license": "MIT",
    "homepage": "https://…",
    "repository": "https://github.com/…",
    "downloadCount": 341,
    "tags": [{ "slug": "pdf", "label": "PDF" }],
    "owner": { "githubLogin": "anish-k", "name": "Anish", "image": "https://…" },
    "latestVersion": {
      "version": "1.2.0",
      "sizeBytes": 20481,
      "checksumSha256": "3a7f…",
      "manifest": {/* the validated component.json */},
      "changelog": "Adds table extraction.",
      "createdAt": "2026-08-01T10:22:31.000Z",
      "downloadUrl": "/api/components/pdf-extractor/versions/1.2.0/download",
    },
    "versionCount": 3,
    "createdAt": "2026-06-11T08:00:00.000Z",
    "updatedAt": "2026-08-01T10:22:31.000Z",
  },
}
```

`readme` is returned as **raw markdown**, never as HTML. Sanitization happens at render
time in one place (`rehype-sanitize`), so there is exactly one XSS control point.

---

### 3.6 `POST /api/uploads/presign` 🔒

Step 1 of publishing. Mints a short-lived, constrained upload URL.

**Request**

```json
{
  "fileName": "pdf-extractor-1.0.0.zip",
  "sizeBytes": 20481,
  "contentType": "application/zip"
}
```

**Validation**

- `sizeBytes` ≤ `10 * 1024 * 1024` → else `413 ARCHIVE_TOO_LARGE`.
- `contentType` ∈ `{ application/zip, application/x-zip-compressed }`.
- `fileName` matches `/^[A-Za-z0-9._-]{1,128}\.zip$/`.
- Rate limit: **10 presigns per user per hour** → else `429`.

**200**

```json
{
  "uploadUrl": "https://…r2.cloudflarestorage.com/staging/usr_abc/01JQ…zip?X-Amz-Signature=…",
  "stagingKey": "staging/usr_abc/01JQ8Z3K7M9V2XW4N6P8R0T2Y5.zip",
  "expiresAt": "2026-08-09T12:15:00.000Z",
  "maxSizeBytes": 10485760
}
```

Implementation requirements:

- The key is **always** `staging/{userId}/{ulid}.zip`. The client never chooses the path —
  a client-supplied key is a bucket-wide write primitive.
- Presign with `createPresignedPost` (or an equivalent `content-length-range` condition)
  so storage itself rejects an oversize body. Never rely on the client honouring
  `maxSizeBytes`.
- TTL **900 s**.

---

### 3.7 `POST /api/components` 🔒 — publish a new component

Step 2. The server now owns validation.

**Request**

```json
{
  "stagingKey": "staging/usr_abc/01JQ8Z3K7M9V2XW4N6P8R0T2Y5.zip",
  "tags": ["pdf", "data-extraction"],
  "changelog": "Initial release."
}
```

Everything else — name, type, version, description, license — comes from the **manifest
inside the archive**, never from the request body. One source of truth; the client cannot
claim a type its manifest contradicts.

**Server pipeline** (detail in [04 §Flow 3](04-sequence-flows.md#flow-3--component-publishing)):

1. Session required → 401.
2. `stagingKey` MUST start with `staging/{session.user.id}/` → else `403 STAGING_FORBIDDEN`.
3. `HeadObject` → exists and within size → else `404 STAGING_NOT_FOUND` / `413`.
4. Stream through `archive.inspector` (yauzl):
   - readable zip → else `422 ARCHIVE_INVALID`
   - entries ≤ 1000, uncompressed total ≤ 50 MB, per-entry compression ratio ≤ 100:1 → else `422 ARCHIVE_UNSAFE`
   - no entry name that is absolute, contains `..`, or is a symlink → else `422 ARCHIVE_UNSAFE`
   - `component.json` at root → else `422 MANIFEST_MISSING`
   - capture `README.md` if present (first 100 KB)
   - compute SHA-256 of the whole archive
5. Zod-parse the manifest → `422 MANIFEST_INVALID` with full `details[]`.
6. Uniqueness: slug free (`409 SLUG_TAKEN`); checksum unseen (`409 DUPLICATE_ARCHIVE`).
7. `CopyObject` staging → `components/{slug}/{version}/{slug}-{version}.zip`; delete staging.
8. Single transaction: insert `Component` + `ComponentVersion`, set `latestVersionId`,
   upsert tags, write `AuditLog`, promote owner `USER` → `PUBLISHER`.

**201**

```json
{
  "data": {
    "slug": "pdf-extractor",
    "version": "1.0.0",
    "url": "/components/pdf-extractor",
    "checksumSha256": "3a7f…"
  }
}
```

**422 example — the response that makes the demo**

```json
{
  "error": {
    "code": "MANIFEST_INVALID",
    "message": "component.json failed validation against spec v1.0.",
    "details": [
      { "path": "version", "message": "Must be valid semver (e.g. 1.0.0)" },
      { "path": "runtime.language", "message": "Required" },
      { "path": "mcp.transport", "message": "Expected one of: stdio, http, sse" }
    ]
  },
  "requestId": "01JQ8Z3K7M9V2XW4N6P8R0T2Y5"
}
```

Idempotency: retrying with the same `stagingKey` after success returns
`409 DUPLICATE_ARCHIVE` (the checksum is already published) rather than creating a second
component. The staging object is deleted on both success and rejection.

---

### 3.8 `POST /api/components/:slug/versions` 🔑

Same pipeline, with these differences:

- Caller MUST be the owner or `ADMIN`.
- Manifest `name` MUST equal the existing component's `name` → else
  `422 MANIFEST_INVALID` (`path: "name"`).
- Manifest `type` MUST equal the existing type — **a component may never change type.**
- Manifest `version` MUST NOT already exist (`409 VERSION_EXISTS`) and MUST sort strictly
  above the current latest by semver (`409 VERSION_NOT_INCREASING`).
- On success, `Component.latestVersionId` moves, and `summary`/`readme`/`license` refresh
  from the new archive.

**201** → `{ "data": { "slug": "…", "version": "1.1.0", "url": "…" } }`

---

### 3.9 `GET /api/components/:slug/versions/:version/download` 🔒

1. Session required → 401.
2. Component must be `PUBLISHED` or `DEPRECATED`; `SUSPENDED` → 404 for non-admins.
3. Version must exist → 404.
4. Insert `Download`, increment `Component.downloadCount` **and** the version's counter.
5. **302** → presigned GET, TTL 300 s, with a `Content-Disposition` attachment filename.

> Counting the download _before_ redirecting slightly over-counts (the user may abort the
> transfer). The alternative — a storage access-log pipeline — is correct but is
> infrastructure you do not need. Note the trade-off; do not build the pipeline.

---

### 3.10 `PATCH /api/components/:slug` 🔑

Only these fields are mutable outside a publish:

```json
{
  "summary": "…",
  "homepage": "https://…",
  "repository": "https://…",
  "tags": ["pdf"],
  "status": "DEPRECATED"
}
```

`name`, `type`, `slug`, and any version data are **immutable**. Attempting them →
`400 VALIDATION_ERROR`.

### 3.11 `DELETE /api/components/:slug` 🔑

Soft delete: sets `deletedAt`, drops it from the catalog. Version rows and stored archives
are retained. Returns `204`.

### 3.12 `POST /api/admin/components/:slug/suspend` 👑

```json
{ "suspended": true, "reason": "Contains hard-coded credentials." }
```

Sets `status = SUSPENDED`, writes `AuditLog`. Returns `200`.

### 3.13 `GET /api/me` 🔒 / `GET /api/me/components` 🔒

`/api/me` → `{ "data": { "id", "name", "email", "image", "githubLogin", "role", "createdAt" } }`

`/api/me/components` → same row shape as the catalog, but includes `DRAFT`/`SUSPENDED`
and soft-deleted items with their status, plus per-component download totals.

### 3.14 `GET /api/tags` —

```json
{ "data": [{ "slug": "pdf", "label": "PDF", "count": 12 }] }
```

Sorted by count desc. Cache 5 minutes.

### 3.15 `GET /api/schemas/component-v1.json` —

Serves the manifest JSON Schema, generated from the Zod schemas at build time. Publishing
this makes `"$schema"` in a manifest resolvable, which gives editors autocomplete and
inline validation for anyone authoring a component. Small endpoint, disproportionate
credibility.

---

## 4. Rate limits

| Endpoint                                | Limit | Window | Key    |
| --------------------------------------- | ----- | ------ | ------ |
| `POST /api/uploads/presign`             | 10    | 1 h    | userId |
| `POST /api/components` and `…/versions` | 20    | 24 h   | userId |
| `GET …/download`                        | 100   | 1 h    | userId |
| `GET /api/components`                   | 120   | 1 min  | ipHash |

v1 implementation: a `RateLimit` table (`key`, `windowStart`, `count`) with an atomic
upsert. Not distributed-perfect under concurrency, and that is acceptable — say so
explicitly rather than pretending otherwise. Swap in Upstash Redis if it ever matters.

Every 429 MUST include `Retry-After` (seconds) and
`X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset`.

## 5. OpenAPI

Generate `openapi.json` from the Zod schemas with `zod-openapi` and serve Scalar or
Swagger UI at `/api/docs`. This is a ~2-hour task in Phase 5 that turns "I wrote some
endpoints" into "I published an API contract" — do not skip it if time allows.
