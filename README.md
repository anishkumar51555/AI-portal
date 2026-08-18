# AI Component Ecosystem Portal

A registry and template hub for four kinds of AI component — **Skills**, **Plugins**,
**Agents**, and **MCP Gateways**. Developers download a validated starter template, build
against a published manifest specification (`component.json`), and publish back into a
searchable catalog.

**Every upload is validated server-side before it enters the catalog.** That validation —
not the CRUD around it — is the point of the project.

---

## What makes it different

Most registries accept a file and hope. This one refuses anything that does not satisfy a
formal specification, and tells the publisher exactly what is wrong.

| Guard                                                        | What it stops                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| **Manifest schema** — a Zod discriminated union over 4 types | A malformed `component.json`. Errors carry a dotted path: `mcp.tools[0].name`         |
| **Archive inspection** — streaming, aborts on first breach   | Zip-slip, decompression bombs, symlinks, entry floods, absolute and backslash paths   |
| **Secret scan**                                              | A real API key pasted into a manifest. The error names the _pattern_, never the value |
| **Two-phase publish**                                        | A catalog row pointing at a missing file. Storage is promoted before the DB commits   |
| **README sanitization**                                      | Stored XSS. `<img onerror>` and `[x](javascript:…)` both render inert                 |

A decompression bomb — 65 KB expanding to 64 MB — is rejected at **entry 2 of 9**, with
zero bytes inflated.

---

## Run it locally

Requires **Node 22+** and **Docker**. About ten minutes, most of it downloading.

```bash
git clone <this-repo> && cd ai-portal
npm install

cp .env.example .env.local     # then fill in the four values below

npm run docker:up              # postgres + minio
npm run db:migrate             # apply migrations
npm run templates:build        # build the four starter archives
npm run db:seed                # tags, templates, demo catalog

npm run dev                    # http://localhost:3000
```

### The four values you must supply

`.env.example` documents every variable; only these need real values:

| Variable                        | How to get it                                                                 |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `AUTH_SECRET`                   | `npx auth secret`, or `openssl rand -base64 32`                               |
| `AUTH_GITHUB_ID` / `..._SECRET` | A [GitHub OAuth app](https://github.com/settings/developers) — callback below |
| `DOWNLOAD_IP_SALT`              | Any long random string. Rotating it resets download de-duplication            |

GitHub OAuth callback URL: `http://localhost:3000/api/auth/callback/github`

Everything else has a working local default.

### Make yourself an admin

```bash
npx tsx scripts/make-admin.mts <your-github-login>
```

---

## The round trip, in 60 seconds

This is the demo, and there is a standing integration test asserting it:

1. Open `/templates`, download the **Skill** template.
2. Unzip, run `npm install && npm test` — it passes as shipped.
3. `npm run pack`, then upload the archive at `/publish`.
4. It appears in `/catalog` as a published Skill.

Then break it deliberately: set `"version": "1.0"`, delete `runtime.language`, re-zip, and
publish again. You get **422** with two precise field errors, and the wizard keeps your
file selected so you can fix and retry.

---

## Commands

```bash
npm run dev              # dev server
npm run gate             # format + lint + typecheck + unit   ← run before every commit
npm run verify           # gate + production build
npm run test             # unit + integration (needs containers)
npm run test:matrix      # which features actually have tests
npm run test:matrix -- --gate P3   # fail if a critical P3 feature is untested
npm run templates:verify # do the four templates still satisfy the spec?
npm run fixtures:build   # regenerate the 12 hostile archive fixtures
npm run docker:up        # postgres + minio
npm run db:migrate       # prisma migrate dev
npm run db:seed          # idempotent seed
```

---

## Architecture

A modular monolith with a one-way dependency rule, enforced by ESLint rather than
convention:

```
app/  ──▶  server/  ──▶  repositories/  ──▶  Prisma
 │           │
 └───────────┴──▶  domain/          (domain imports nothing)
```

- **`domain/`** — Zod schemas, inferred types, the error taxonomy. Zero project imports, so
  it is safe in the browser bundle.
- **`server/services/`** — business logic. Must not import `next/*`, which is what keeps it
  unit-testable in plain Vitest and liftable into a separate service later.
- **`server/repositories/`** — the only place `prisma.*` appears.
- **`app/`** — routing only. Four steps per handler: authorize, validate, delegate, shape.

A violation fails CI. Full reasoning in [`docs/01-architecture.md`](docs/01-architecture.md).

### Publishing is two-phase

```
presign → client uploads straight to storage → validate → CopyObject → DB transaction
```

The archive bytes never pass through the application server, which sidesteps serverless
body limits entirely. **Storage is promoted before the database commits**: an orphaned
object is harmless, a catalog row pointing at a missing file is a user-visible 404.

---

## Testing

Coverage is deliberately uneven — high where a bug is expensive, absent where tests rot
fastest.

| Area                | Bar              | Why                                           |
| ------------------- | ---------------- | --------------------------------------------- |
| `domain/schemas/`   | 95%              | The specification. A bug corrupts the catalog |
| `archive.inspector` | 95%              | Security boundary. Every guard needs a test   |
| `server/services/`  | 80%              | Business logic                                |
| `app/api/`          | integration only | Thin handlers; unit tests would test mocks    |
| `components/`       | ~0%              | UI unit tests rot fastest, catch least        |

Integration tests run against a **real** Postgres and a **real** MinIO. Nothing is mocked
at that layer — a mocked database tests your mock.

Beyond line coverage there is a **feature matrix**: every shipped feature is registered in
`tests/feature-map.ts` and must have a test at the right level. `npm run test:matrix`
reports it; CI fails if a critical feature in a completed phase is untested. A unit test of
a helper cannot satisfy an integration-level feature — that check exists because it caught
three features marked green before the endpoints they describe were built.

---

## Deploying

```bash
docker build --build-arg NEXT_PUBLIC_APP_URL=https://your-domain .
```

`NEXT_PUBLIC_*` is inlined into the client bundle at build time, so it must be a build arg;
every other secret is supplied at runtime. The image is multi-stage, runs as a non-root
`nextjs` user, and ships a `HEALTHCHECK`.

Production targets Vercel + Neon (Postgres) + Cloudflare R2 (S3-compatible storage). See
[`docs/05-infrastructure.md`](docs/05-infrastructure.md) and
[`docs/10-cicd-and-deployment.md`](docs/10-cicd-and-deployment.md).

---

## Honest limitations

Stated plainly, because a vague claim of safety is weaker than a precise one:

- **Uploaded code is never executed, sandboxed, or behaviourally analysed.** The portal
  validates structure, not intent. A published component can contain arbitrary code and a
  consumer runs it at their own risk — exactly as with npm or PyPI. Mitigations: every
  component is attributable to a GitHub identity, an admin can suspend within seconds,
  every publish is audited, and checksums let a consumer verify what they got.
- **Rate limiting is a fixed window, not sliding.** A caller can burst across a window
  boundary at roughly double the nominal rate. Acceptable for abuse damping; swap in Redis
  if it ever needs to be exact.
- **Download counts slightly over-count.** They are incremented before the redirect, so an
  aborted transfer still counts. The correct fix is a storage access-log pipeline, which
  is infrastructure this project deliberately does not build.

---

## Documentation

[`docs/`](docs/README.md) is the specification — if code and docs disagree, that is a bug
in one of them.

| Document                                                           | Covers                                 |
| ------------------------------------------------------------------ | -------------------------------------- |
| [`00-overview`](docs/00-overview.md)                               | Scope, and the binding non-goals       |
| [`01-architecture`](docs/01-architecture.md)                       | Layers, boundaries, rendering          |
| [`02-data-model`](docs/02-data-model.md)                           | Schema, full-text search, seeds        |
| [`03-api-contract`](docs/03-api-contract.md)                       | Every endpoint, the error taxonomy     |
| [`06-component-manifest-spec`](docs/06-component-manifest-spec.md) | **The manifest specification**         |
| [`08-security-model`](docs/08-security-model.md)                   | Threats, controls, upload pipeline     |
| [`adr/`](docs/adr/)                                                | Why each significant decision was made |

## Licence

MIT.
