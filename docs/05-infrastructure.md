# 05 — Infrastructure & Environments

## 1. Strategy

Two environments. Identical code, identical storage API, different providers.

|                | **Development**                | **Production**                                   |
| -------------- | ------------------------------ | ------------------------------------------------ |
| Runtime        | `next dev` on the Windows host | Vercel (Node 22 serverless)                      |
| Database       | PostgreSQL 16 in Docker        | Neon (free tier, serverless Postgres)            |
| Object storage | MinIO in Docker                | Cloudflare R2 (10 GB free, **zero egress fees**) |
| Auth callback  | `http://localhost:3000`        | `https://‹app›.vercel.app`                       |
| Secrets        | `.env.local` (gitignored)      | Vercel project env vars                          |
| Cost           | ₹0                             | ₹0                                               |

**The invariant that makes this work:** MinIO, R2, AWS S3, and Azure Blob all speak the
S3 API. `storage.service.ts` targets that API and nothing else. Switching providers is
four environment variables — the codebase does not know which one it is talking to.

A production **Dockerfile** and an **Azure DevOps pipeline** are also delivered
([10](10-cicd-and-deployment.md)). Vercel does not consume the Dockerfile, but the image
builds, runs, and is published to GHCR by CI — so the container deliverable is real and
verifiable (`docker run` it locally), not decorative. If Vercel ever fails you, the same
image deploys to Azure Container Apps, Fly.io, or Render without changes.

## 2. Development topology

```mermaid
graph TB
    subgraph host["Windows 11 host"]
        DEV["<b>next dev</b><br/>localhost:3000<br/>Turbopack HMR"]
        PSQL["psql / Prisma Studio<br/>localhost:5555"]
    end

    subgraph compose["Docker Compose — ai-portal-dev network"]
        PG[("<b>postgres:16-alpine</b><br/>:5432<br/>volume: pgdata")]
        MINIO[("<b>minio</b><br/>:9000 API · :9001 console<br/>volume: miniodata")]
        INIT["<b>minio-init</b><br/>one-shot: create bucket,<br/>set lifecycle + CORS,<br/>then exit 0"]
    end

    GH["<b>GitHub OAuth App</b><br/>callback → localhost:3000"]

    DEV -->|"DATABASE_URL<br/>postgresql://…@localhost:5432/ai_portal"| PG
    DEV -->|"S3_ENDPOINT<br/>http://localhost:9000"| MINIO
    DEV -->|OIDC| GH
    PSQL --> PG
    INIT -.->|mc mb / mc ilm / mc cors| MINIO

    BROWSER["Browser"] -->|"presigned PUT/GET<br/>direct to :9000"| MINIO
    BROWSER --> DEV

    classDef svc fill:#2d6a4f,stroke:#1b4332,color:#fff
    classDef app fill:#1168bd,stroke:#0b4884,color:#fff
    class PG,MINIO,INIT svc
    class DEV,PSQL app
```

> **Why `next dev` runs on the host, not in a container.** File-watching across the
> Windows→WSL2 bind-mount boundary is slow and flaky; hot reload can take seconds or miss
> changes entirely. Containerize the _stateful dependencies_, run the app natively. This
> is what experienced teams on Windows actually do, and it is a better answer than
> "everything in Docker" if asked why.

### 2.1 `docker-compose.yml`

```yaml
name: ai-portal

services:
  postgres:
    image: postgres:16-alpine
    container_name: ai-portal-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: portal
      POSTGRES_PASSWORD: portal_dev_password
      POSTGRES_DB: ai_portal
      # Deterministic collation so index ordering matches production.
      POSTGRES_INITDB_ARGS: "--encoding=UTF8 --locale=C"
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U portal -d ai_portal"]
      interval: 5s
      timeout: 5s
      retries: 10

  minio:
    image: minio/minio:latest
    container_name: ai-portal-minio
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - "9000:9000" # S3 API
      - "9001:9001" # web console
    volumes:
      - miniodata:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 5s
      retries: 10

  # One-shot bootstrap: bucket, lifecycle rule, CORS. Exits 0 when done.
  minio-init:
    image: minio/mc:latest
    depends_on:
      minio:
        condition: service_healthy
    entrypoint: >
      /bin/sh -c "
      mc alias set local http://minio:9000 minioadmin minioadmin &&
      mc mb --ignore-existing local/ai-portal &&
      mc anonymous set none local/ai-portal &&
      mc ilm rule add --expire-days 1 --prefix 'staging/' local/ai-portal || true &&
      echo '[minio-init] bucket ready';
      "

volumes:
  pgdata:
  miniodata:
```

### 2.2 Browser CORS on MinIO

The browser PUTs directly to `localhost:9000`, which is a cross-origin request from
`localhost:3000`. MinIO must allow it or Phase 3 dies with an opaque CORS error at the
worst possible moment.

```powershell
docker exec ai-portal-minio mc alias set local http://localhost:9000 minioadmin minioadmin
docker exec ai-portal-minio mc cors set local/ai-portal --rule '{
  "AllowedOrigins": ["http://localhost:3000"],
  "AllowedMethods": ["GET","PUT","HEAD"],
  "AllowedHeaders": ["*"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3000
}'
```

R2 needs the equivalent rule in the dashboard, with your production origin.

> **Gotcha that costs an afternoon:** MinIO requires `forcePathStyle: true` in the S3
> client (`http://localhost:9000/ai-portal/key`). R2 and S3 use virtual-host style. Drive
> it from an env var: `S3_FORCE_PATH_STYLE=true` locally, `false` in production.

### 2.3 Environment variables

`.env.example` is committed. `.env.local` is not, ever.

```bash
# ── Core ───────────────────────────────────────────────
NODE_ENV=development
NEXT_PUBLIC_APP_URL=http://localhost:3000

# ── Database ───────────────────────────────────────────
DATABASE_URL="postgresql://portal:portal_dev_password@localhost:5432/ai_portal?schema=public"

# ── Auth.js ────────────────────────────────────────────
AUTH_SECRET=            # openssl rand -base64 32   (or: npx auth secret)
AUTH_URL=http://localhost:3000
AUTH_GITHUB_ID=
AUTH_GITHUB_SECRET=
AUTH_TRUST_HOST=true    # required on Vercel and behind any proxy

# ── Object storage (S3-compatible) ─────────────────────
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=ai-portal
S3_ACCESS_KEY_ID=minioadmin
S3_SECRET_ACCESS_KEY=minioadmin
S3_FORCE_PATH_STYLE=true
S3_PUBLIC_ENDPOINT=http://localhost:9000   # what the BROWSER should hit; differs from
                                           # S3_ENDPOINT if the app talks to storage
                                           # over an internal network name

# ── Limits ─────────────────────────────────────────────
MAX_UPLOAD_BYTES=10485760          # 10 MB compressed
MAX_UNCOMPRESSED_BYTES=52428800    # 50 MB expanded
MAX_ARCHIVE_ENTRIES=1000
MAX_COMPRESSION_RATIO=100
PRESIGN_TTL_SECONDS=900
DOWNLOAD_TTL_SECONDS=300

# ── Privacy / ops ──────────────────────────────────────
DOWNLOAD_IP_SALT=       # openssl rand -hex 16
LOG_LEVEL=debug
```

**Validate these at boot.** `src/lib/env.ts` parses `process.env` with Zod and throws on
startup if anything is missing or malformed:

```ts
// src/lib/env.ts — fail fast, fail loud, fail at boot
import { z } from "zod";

const serverSchema = z.object({
  DATABASE_URL: z.url().startsWith("postgresql://"),
  AUTH_SECRET: z.string().min(32),
  AUTH_GITHUB_ID: z.string().min(1),
  AUTH_GITHUB_SECRET: z.string().min(1),
  S3_ENDPOINT: z.url(),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.stringbool().default(false),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10_485_760),
  DOWNLOAD_IP_SALT: z.string().min(16),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
});

// Only NEXT_PUBLIC_* may ever reach the browser bundle.
const clientSchema = z.object({ NEXT_PUBLIC_APP_URL: z.url() });

export const env = serverSchema.parse(process.env);
export const clientEnv = clientSchema.parse({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});
```

A missing `AUTH_SECRET` should crash the process in 50 ms with a clear message — not
produce a mysterious 500 three days later. The server/client split is the mechanism that
prevents an S3 secret from being bundled into client JavaScript.

### 2.4 First-run sequence

```powershell
git clone ‹repo›; cd ai-portal
copy .env.example .env.local        # then fill AUTH_SECRET + GitHub OAuth creds
npm install
docker compose up -d                # postgres + minio + bucket bootstrap
npm run db:migrate                  # prisma migrate dev
npm run db:seed                     # tags, 4 templates uploaded to MinIO, demo data
npm run dev                         # http://localhost:3000
```

Target: **under 10 minutes on a clean machine.** Time it yourself once, and fix whatever
made it slower.

**GitHub OAuth app setup** (once, at <https://github.com/settings/developers>):

- Homepage URL → `http://localhost:3000`
- Authorization callback URL → `http://localhost:3000/api/auth/callback/github`
- Create a **second** OAuth app for production with the Vercel URL. Do not share one app
  across environments — a single callback URL cannot serve both.

---

## 3. Production topology

```mermaid
graph TB
    USER["👤 User browser"]

    subgraph edge["Vercel Edge Network"]
        CDN["CDN / static assets<br/>immutable, hashed"]
        MWE["Middleware<br/>session check, security headers"]
    end

    subgraph app["Vercel Serverless — Node 22"]
        RSC["Server Components<br/>catalog · detail · dashboard"]
        API["Route Handlers<br/>/api/*"]
        AUTHF["Auth.js handlers"]
    end

    subgraph data["Managed data services"]
        NEON[("<b>Neon PostgreSQL 16</b><br/>free tier · pooled connection<br/>auto-suspend when idle")]
        R2[("<b>Cloudflare R2</b><br/>bucket: ai-portal<br/>PRIVATE · 10GB free · 0 egress")]
    end

    GH["GitHub OAuth"]
    GHCR["GHCR<br/>container image<br/>ghcr.io/‹you›/ai-portal:sha"]
    SENTRY["Sentry (free)<br/>errors + traces"]

    USER --> CDN
    USER --> MWE --> RSC
    USER --> API
    USER -.->|"<b>presigned PUT / GET — direct</b>"| R2

    RSC -->|"Prisma over pooled URL"| NEON
    API --> NEON
    API -->|"S3 API: presign, head, copy, delete"| R2
    AUTHF --> GH
    AUTHF --> NEON
    API -.-> SENTRY

    CI["GitHub Actions"] -->|build + push| GHCR
    CI -->|"prisma migrate deploy"| NEON
    CI -->|deploy| app

    classDef managed fill:#2d6a4f,stroke:#1b4332,color:#fff
    classDef vercel fill:#111,stroke:#333,color:#fff
    classDef ext fill:#6b7280,color:#fff
    class NEON,R2 managed
    class CDN,MWE,RSC,API,AUTHF vercel
    class GH,GHCR,SENTRY,CI ext
```

### 3.1 Production configuration notes

| Concern              | Setting                                                                  | Why                                                                                                              |
| -------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Neon connection      | Use the **pooled** connection string (`-pooler` host) for `DATABASE_URL` | Serverless functions open a connection per invocation; the direct URL exhausts the connection cap under any load |
| Neon migrations      | Use the **direct** (unpooled) URL for `prisma migrate deploy`            | PgBouncer in transaction mode cannot run DDL reliably                                                            |
| R2 bucket access     | **Private.** No public bucket, no public dev URL.                        | Every byte leaves through a presigned URL you minted and logged                                                  |
| R2 lifecycle         | Delete `staging/` objects after 1 day                                    | Abandoned uploads cannot accumulate cost                                                                         |
| R2 CORS              | Allow `PUT, GET, HEAD` from the production origin only                   | Direct browser upload needs it; anything wider is a gift to an attacker                                          |
| `AUTH_TRUST_HOST`    | `true`                                                                   | Required behind Vercel's proxy or OAuth callbacks fail with a host mismatch                                      |
| `AUTH_URL`           | The exact production origin                                              | Preview deployments have different hostnames; OAuth breaks unless you add each callback                          |
| Prisma on serverless | Reuse the client via a `globalThis` singleton                            | Prevents connection-pool exhaustion from module re-evaluation                                                    |

### 3.2 Free-tier limits worth knowing before they surprise you

| Service      | Limit                                         | What happens at the edge                     | Mitigation                                                |
| ------------ | --------------------------------------------- | -------------------------------------------- | --------------------------------------------------------- |
| Neon free    | 0.5 GB storage, auto-suspend after 5 min idle | First request after idle takes ~500 ms extra | Acceptable. Mention it as a known cold-start in the demo. |
| R2 free      | 10 GB stored, 1M Class-A ops/mo               | Uploads fail once full                       | 10 MB cap × ~1000 components. Fine.                       |
| Vercel Hobby | 100 GB bandwidth, 10 s function timeout       | Long validation would time out               | Validation targets < 3 s. Not close to the limit.         |
| Vercel Hobby | **Non-commercial use only**                   | —                                            | This is a portfolio project. Compliant.                   |
| GitHub OAuth | No practical limit                            | —                                            | —                                                         |

### 3.3 Alternative deploy target — the same image, elsewhere

Because the Dockerfile is real, this works today without code changes:

```powershell
docker build -t ai-portal:local .
docker run --rm -p 3000:3000 --env-file .env.production.local ai-portal:local
```

That command is the proof the containerization deliverable is genuine. Run it once, take
a screenshot, put it in the README. Azure Container Apps, Fly.io, and Render all consume
the same image; [10 §5](10-cicd-and-deployment.md#5-azure-devops-pipeline) has the Azure
path.

---

## 4. Object storage layout

```
ai-portal/                                    (private bucket)
├── templates/
│   ├── skill/1.0.0/skill-template-1.0.0.zip
│   ├── plugin/1.0.0/plugin-template-1.0.0.zip
│   ├── agent/1.0.0/agent-template-1.0.0.zip
│   └── mcp-gateway/1.0.0/mcp-gateway-template-1.0.0.zip
│
├── staging/                                  ← lifecycle: delete after 1 day
│   └── {userId}/{ulid}.zip                   ← never catalog-visible; server writes the key
│
└── components/
    └── {slug}/
        └── {version}/
            └── {slug}-{version}.zip          ← immutable once written
```

**Rules:**

1. The bucket is private. There is no public-read path, ever.
2. The client never supplies an object key. The server derives every key.
3. `components/**` is write-once. A new version is a new key, never an overwrite —
   this is what makes the checksum guarantee meaningful.
4. `staging/{userId}/` is the isolation boundary. A publish request whose `stagingKey`
   does not begin with the caller's own prefix is rejected before any storage call.

---

## 5. Production Dockerfile

Multi-stage, non-root, standalone output. Requires `output: "standalone"` in
`next.config.ts`.

```dockerfile
# syntax=docker/dockerfile:1.7

# ── deps: install with a warm, cacheable layer ─────────────────
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.npm npm ci

# ── builder ────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate
RUN npm run build          # emits .next/standalone

# ── runner: minimal, non-root ──────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

COPY --from=builder /app/public                        ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static     ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/prisma           ./prisma
COPY --from=builder /app/node_modules/.prisma/client   ./node_modules/.prisma/client

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
```

**Every line here is a deliberate practice worth being able to explain:**

| Practice                           | Why                                                                                                                   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Multi-stage                        | Build tools never ship. Final image ≈ 180 MB instead of ≈ 1.2 GB.                                                     |
| `npm ci`, not `npm install`        | Respects the lockfile exactly; reproducible builds                                                                    |
| Copy `package*.json` before source | Dependencies re-install only when the lockfile changes                                                                |
| `--mount=type=cache`               | BuildKit cache for the npm store; big CI speedup                                                                      |
| Non-root `USER nextjs`             | A container escape starts unprivileged. The most commonly skipped Docker practice, and the one reviewers check first. |
| `output: "standalone"`             | Next traces exactly the needed `node_modules`; no `npm i --production` in the runner                                  |
| `HEALTHCHECK`                      | Orchestrators can tell "running" from "working"                                                                       |
| Pinned base tag                    | `node:22-alpine`, not `node:latest`. Pin to a digest for real production.                                             |

Companion `.dockerignore` (as important as the Dockerfile — it is what keeps `.env` and
`.git` out of the build context):

```
node_modules
.next
.git
.env*
!.env.example
docs
*.md
!README.md
.claude
coverage
playwright-report
test-results
Dockerfile
docker-compose.yml
```
