# 04 — End-to-End Sequence Flows

The runtime behaviour of every journey that matters. Read the relevant flow before
implementing it; these diagrams are the specification, not decoration.

---

## Flow 0 — The complete round trip

The single most important picture in this project. Everything else supports it.

```mermaid
graph LR
    A["<b>1. Sign in</b><br/>GitHub OAuth"] --> B["<b>2. Download template</b><br/>MCP Gateway starter"]
    B --> C["<b>3. Build locally</b><br/>edit code + component.json"]
    C --> D["<b>4. Publish</b><br/>zip → presign → validate"]
    D -->|"❌ manifest invalid"| E["<b>Field-level errors</b><br/>fix and retry"]
    E --> C
    D -->|"✅ valid"| F["<b>5. Live in catalog</b><br/>indexed, searchable"]
    F --> G["<b>6. Another dev finds it</b><br/>search + filter"]
    G --> H["<b>7. Downloads it</b><br/>presigned URL"]
    H --> I["<b>8. Uses it</b><br/>or forks it into a new component"]
    I -.->|"contribute back"| C

    style A fill:#1168bd,color:#fff
    style D fill:#7c3aed,color:#fff
    style E fill:#b91c1c,color:#fff
    style F fill:#15803d,color:#fff
    style H fill:#15803d,color:#fff
```

**The loop closes** because the templates are themselves manifest-valid components. That
is the property to demo first and lead with in an interview.

---

## Flow 1 — Authentication (GitHub OAuth + RBAC)

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant MW as Middleware
    participant A as Auth.js (Route Handler)
    participant GH as GitHub OAuth
    participant DB as PostgreSQL

    B->>MW: GET /publish
    MW->>MW: read session cookie → absent
    MW-->>B: 307 → /login?callbackUrl=/publish

    B->>A: POST /api/auth/signin/github
    A->>A: generate state + PKCE verifier, set httpOnly cookies
    A-->>B: 302 → github.com/login/oauth/authorize
    B->>GH: authorize (user consents)
    GH-->>B: 302 → /api/auth/callback/github?code=…&state=…

    B->>A: GET /api/auth/callback/github
    A->>A: verify state matches cookie (CSRF defence)
    A->>GH: POST /login/oauth/access_token (code + PKCE verifier)
    GH-->>A: access_token
    A->>GH: GET /user, GET /user/emails
    GH-->>A: profile { login, email, avatar_url }

    A->>DB: upsert User + Account (@auth/prisma-adapter)
    DB-->>A: user { id, role }
    A->>DB: insert AuditLog(USER_SIGNED_IN)
    A->>A: sign JWT { sub, role, githubLogin }
    A-->>B: Set-Cookie authjs.session-token (httpOnly, Secure, SameSite=Lax)<br/>302 → /publish

    B->>MW: GET /publish (with cookie)
    MW->>MW: session present → allow
    MW-->>B: page (Server Component re-verifies with auth())
```

### Implementation notes

- **Session strategy: JWT, not database.** Every request would otherwise cost a session
  SELECT. JWT keeps middleware edge-compatible and stateless. Cost: role changes take
  effect on next token refresh (max 24 h). Acceptable — and worth stating as a conscious
  trade-off.
- **`role` is copied into the JWT** in the `jwt` callback on first sign-in, then surfaced
  in the `session` callback. Without this, every authorization check hits the database.
- **Step 21 is not optional.** Middleware checks only _cookie presence_ — it is a
  redirect for UX. Real authorization happens in the Server Component / Route Handler via
  `await auth()`. Treating middleware as the security boundary is the single most common
  Next.js auth vulnerability; see [08 §2.3](08-security-model.md#23-middleware-is-not-a-security-boundary).

---

## Flow 2 — Template download

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant R as Route Handler<br/>/api/templates/[type]/download
    participant AZ as authz
    participant S as template.service
    participant DB as PostgreSQL
    participant ST as Object Storage

    B->>R: GET /api/templates/mcp-gateway/download
    R->>AZ: requireAuth()
    alt no session
        AZ-->>B: 401 UNAUTHENTICATED
    end
    R->>R: Zod-parse :type → MCP_GATEWAY
    R->>S: getDownloadRedirect(MCP_GATEWAY, user, ip)
    S->>DB: SELECT Template WHERE type = 'MCP_GATEWAY'
    alt not found
        DB-->>B: 404 NOT_FOUND
    end
    S->>DB: BEGIN<br/>INSERT Download(kind=TEMPLATE, ipHash)<br/>UPDATE Template SET downloadCount += 1<br/>COMMIT
    S->>ST: getSignedUrl(GetObject, key, 300s,<br/>content-disposition: attachment)
    ST-->>S: https://…?X-Amz-Signature=…
    S-->>R: url
    R-->>B: 302 Location: <presigned url><br/>Cache-Control: no-store
    B->>ST: GET <presigned url>
    ST-->>B: mcp-gateway-template-1.0.0.zip
```

`Cache-Control: no-store` on the redirect matters: a cached 302 would hand a stale,
expired signature to the next user.

---

## Flow 3 — Component publishing

The most complex flow. Two HTTP round trips to the app plus one direct-to-storage upload.

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser (upload wizard)
    participant P as POST /api/uploads/presign
    participant C as POST /api/components
    participant INS as archive.inspector
    participant VAL as manifest.validator (Zod)
    participant ST as Object Storage
    participant DB as PostgreSQL

    Note over B,P: ── Phase 1: obtain a constrained upload URL ──
    B->>P: { fileName, sizeBytes, contentType }
    P->>P: requireAuth() · Zod · size ≤ 10MB · rate limit
    P->>ST: createPresignedPost(<br/>key = staging/{userId}/{ulid}.zip,<br/>content-length-range 1..10MB, TTL 900s)
    ST-->>P: { url, fields }
    P-->>B: { uploadUrl, stagingKey, expiresAt }

    Note over B,ST: ── Phase 2: bytes go browser → storage, never through the app ──
    B->>ST: PUT <uploadUrl> (the .zip)
    ST-->>B: 204 (or 400 EntityTooLarge — enforced by storage itself)

    Note over B,DB: ── Phase 3: server-side validation and promotion ──
    B->>C: { stagingKey, tags[], changelog }
    C->>C: requireAuth()
    C->>C: assert stagingKey startsWith "staging/{userId}/"
    alt prefix mismatch
        C-->>B: 403 STAGING_FORBIDDEN
    end
    C->>ST: HeadObject(stagingKey)
    alt missing / expired
        ST-->>B: 404 STAGING_NOT_FOUND
    end

    C->>INS: inspect(stream)
    INS->>INS: streaming zip walk (yauzl)
    Note right of INS: entries ≤ 1000<br/>uncompressed ≤ 50MB<br/>ratio ≤ 100:1 per entry<br/>no "..", no absolute paths<br/>no symlinks<br/>SHA-256 over the stream
    alt any guard trips
        INS-->>B: 422 ARCHIVE_UNSAFE / 413 ARCHIVE_TOO_LARGE
    end
    INS->>INS: extract component.json (+ README.md ≤100KB)
    alt no component.json at root
        INS-->>B: 422 MANIFEST_MISSING
    end

    INS->>VAL: parse(rawManifest)
    VAL->>VAL: base schema → discriminated union on `type`
    alt invalid
        VAL-->>C: ZodError
        C->>ST: DeleteObject(stagingKey)
        C->>DB: INSERT AuditLog(UPLOAD_REJECTED)
        C-->>B: 422 MANIFEST_INVALID + details[]
    end

    C->>DB: slug free? checksum unseen?
    alt conflict
        C->>ST: DeleteObject(stagingKey)
        C-->>B: 409 SLUG_TAKEN / DUPLICATE_ARCHIVE
    end

    Note over C,ST: promote storage FIRST, then commit DB
    C->>ST: CopyObject → components/{slug}/{version}/{slug}-{version}.zip
    C->>ST: DeleteObject(stagingKey)

    C->>DB: BEGIN
    C->>DB: INSERT Component
    C->>DB: INSERT ComponentVersion (manifest, objectKey, checksum, size)
    C->>DB: UPDATE Component SET latestVersionId
    C->>DB: upsert Tags + ComponentTag
    C->>DB: UPDATE User SET role='PUBLISHER' WHERE role='USER'
    C->>DB: INSERT AuditLog(COMPONENT_PUBLISHED)
    C->>DB: COMMIT
    C-->>B: 201 { slug, version, url }
    B->>B: router.push(/components/{slug})
```

### Why the ordering in Phase 3 is what it is

| Step                                | Placed here because                                                                                              |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Prefix check before `HeadObject`    | Cheapest check first, and it prevents probing other users' staging keys via timing                               |
| Safety guards before manifest parse | Never parse content from an archive you have not proven safe                                                     |
| Uniqueness before `CopyObject`      | Avoid writing bytes you are about to reject                                                                      |
| `CopyObject` before `BEGIN`         | A crash mid-way leaves an orphaned object (harmless) rather than a catalog row with no file (a user-visible 404) |
| Everything DB in one transaction    | Component, version, tags, role, and audit either all exist or none do                                            |
| Staging deleted on **both** paths   | Rejected uploads must not linger; the 24 h lifecycle rule is a backstop, not the mechanism                       |

### Client-side wizard states

```mermaid
stateDiagram-v2
    [*] --> SelectFile
    SelectFile --> ClientPrecheck: file chosen
    ClientPrecheck --> SelectFile: not a .zip / >10MB
    ClientPrecheck --> Presigning: ok
    Presigning --> Uploading: got uploadUrl
    Presigning --> Failed: 401 / 413 / 429
    Uploading --> Validating: PUT complete (progress bar)
    Uploading --> Failed: network error → offer retry with same key
    Validating --> Succeeded: 201
    Validating --> ManifestErrors: 422 with details[]
    Validating --> Conflict: 409
    ManifestErrors --> SelectFile: errors rendered per field path
    Succeeded --> [*]
    Conflict --> [*]
    Failed --> [*]
```

Client pre-checks are UX, not security. Every one of them is re-checked server-side.

---

## Flow 4 — Discovery & download

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant RSC as /catalog (Server Component)
    participant REPO as component.repository
    participant DB as PostgreSQL
    participant D as /api/components/[slug]/versions/[v]/download
    participant ST as Object Storage

    B->>RSC: GET /catalog?q=pdf&type=skill&tags=parsing&page=1
    RSC->>RSC: Zod-parse searchParams (invalid → coerce to defaults, never throw)
    RSC->>REPO: search(criteria)
    REPO->>DB: $transaction([ rows query, facet counts ])
    Note right of DB: WHERE deletedAt IS NULL<br/>AND status IN (PUBLISHED, DEPRECATED)<br/>AND searchVector @@ websearch_to_tsquery('english', $q)<br/>ORDER BY ts_rank DESC, downloadCount DESC<br/>-- GIN index on searchVector
    DB-->>REPO: rows + facets
    REPO-->>RSC: CatalogPage
    RSC-->>B: streamed HTML (Suspense: filters instant, results stream in)

    B->>B: type in search box (Client Component)
    B->>B: debounce 300ms → router.replace(?q=…) — shallow, URL is the state
    B->>RSC: RSC re-fetch for the new searchParams only

    B->>RSC: GET /components/pdf-extractor
    RSC->>DB: component + latestVersion + tags + owner
    RSC-->>B: detail page (README via react-markdown + rehype-sanitize)

    B->>D: click Download
    D->>D: requireAuth()
    alt no session
        D-->>B: 401 → UI redirects to /login?callbackUrl=…
    end
    D->>DB: status check → INSERT Download → increment counters
    D->>ST: getSignedUrl(GetObject, 300s, attachment filename)
    D-->>B: 302 → presigned URL (Cache-Control: no-store)
    B->>ST: GET
    ST-->>B: pdf-extractor-1.2.0.zip
```

**The URL is the state.** Search, filters, sort, and page all live in `searchParams`. This
gives shareable and back-button-correct URLs for free, keeps the results server-rendered
and indexable, and eliminates a client-side state store. It is the App Router idiom and a
visible sign you understand the framework rather than fighting it.

---

## Flow 5 — Admin suspension

```mermaid
sequenceDiagram
    autonumber
    participant A as Admin browser
    participant R as POST /api/admin/components/[slug]/suspend
    participant AZ as authz
    participant DB as PostgreSQL

    A->>R: { suspended: true, reason: "hard-coded credentials" }
    R->>AZ: requireRole("ADMIN")
    alt not admin
        AZ-->>A: 403 FORBIDDEN
    end
    R->>DB: BEGIN<br/>UPDATE Component SET status='SUSPENDED'<br/>INSERT AuditLog(COMPONENT_SUSPENDED, {reason})<br/>COMMIT
    R-->>A: 200
    Note over DB: Component now 404s for everyone except ADMIN.<br/>Archive is retained — suspension is reversible.
```

---

## Flow 6 — CI/CD

```mermaid
graph TB
    DEV["Developer<br/>git push feature/x"] --> PR["Pull Request → main"]

    subgraph ci["CI — runs on every PR"]
        direction TB
        L["Lint<br/>eslint + prettier --check"]
        T["Typecheck<br/>tsc --noEmit"]
        U["Unit tests<br/>vitest run --coverage"]
        M["Migration check<br/>prisma migrate diff --exit-code"]
        B["Build<br/>next build"]
        I["Integration tests<br/>against Postgres + MinIO services"]
        S["Security<br/>npm audit --audit-level=high<br/>CodeQL · Trivy image scan"]
    end

    PR --> L & T & U & M
    L & T & U & M --> B
    B --> I
    B --> S

    I & S --> GATE{"all green?"}
    GATE -->|no| BLOCK["❌ merge blocked"]
    GATE -->|yes| MERGE["✅ merge to main"]

    MERGE --> CD

    subgraph cd["CD — on main"]
        direction TB
        IMG["docker build<br/>multi-stage, non-root"]
        PUSH["push to GHCR<br/>tags: sha + latest"]
        MIG["prisma migrate deploy<br/>against production DB"]
        DEP["deploy to Vercel"]
        SMOKE["smoke: GET /api/health?deep=1"]
    end

    IMG --> PUSH --> MIG --> DEP --> SMOKE
    SMOKE -->|fail| RB["rollback: promote previous deployment"]
    SMOKE -->|pass| DONE["🟢 live"]

    classDef pass fill:#15803d,color:#fff
    classDef fail fill:#b91c1c,color:#fff
    class MERGE,DONE pass
    class BLOCK,RB fail
```

**Migrations run before the deploy, not after.** The new code may depend on the new schema;
the old code must tolerate it. That is why schema changes are additive (expand/contract)
and why `prisma migrate diff --exit-code` in CI catches a schema edited without a
migration — the most common way a solo developer breaks their own deploy.

---

## Flow 7 — Failure handling summary

| Failure                                 | Detected where         | User sees                                           | System does                                                                         |
| --------------------------------------- | ---------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| OAuth denied by user                    | Auth.js callback       | `/login?error=AccessDenied` with a readable message | Nothing persisted                                                                   |
| Presign rate limit hit                  | `/api/uploads/presign` | "Too many uploads. Try again in 43 min."            | 429 + `Retry-After`                                                                 |
| Browser→storage PUT fails               | Client                 | Retry button, same staging key reused               | Nothing; key expires in 24 h                                                        |
| Zip bomb                                | `archive.inspector`    | "Archive expands beyond the 50 MB limit."           | Staging deleted; `UPLOAD_REJECTED` logged                                           |
| Manifest invalid                        | `manifest.validator`   | Per-field errors inline in the wizard               | Staging deleted; `UPLOAD_REJECTED` logged                                           |
| Crash after `CopyObject`, before commit | —                      | 500 with a request id                               | Orphaned object; retry succeeds (new checksum check passes since nothing committed) |
| DB unreachable                          | Repository             | Generic 500 + request id                            | pino `error` with request id; `/api/health?deep=1` reports degraded                 |
| Presigned URL expires mid-download      | Storage                | 403 from the storage host                           | User clicks download again; new URL minted                                          |
