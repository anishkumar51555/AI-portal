# 10 — CI/CD & Deployment

Two pipelines are delivered: **GitHub Actions** (the one that actually runs) and
**Azure DevOps** (the spec's bonus objective). They express the same stages, so the
comparison itself becomes an interview talking point.

## 1. Branching & release

**Trunk-based development with short-lived branches.** `main` is always deployable.

```
main ─────●───────●───────●───────●──▶  (protected; every commit deploys)
           \     /         \     /
            ●───●           ●───●        feat/… fix/… — hours to 2 days, never longer
```

Branch protection on `main`: require a PR, require all status checks, no force-push.
Yes, even solo — the discipline is the point, and "I protected my own main branch" is a
better answer than most.

**Conventional Commits**, because they make the changelog generatable:

```
feat(publish): validate manifest against spec v1.0
fix(storage): use path-style addressing for MinIO
docs(adr): record the storage abstraction decision
chore(deps): bump prisma to 7.9.1
```

`feat` → minor, `fix` → patch, `!` or `BREAKING CHANGE:` → major.

## 2. GitHub Actions — CI

`.github/workflows/ci.yml`. Runs on every PR and every push to `main`.

```yaml
name: CI
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true # a new push supersedes the running build

env:
  NODE_VERSION: "22"

jobs:
  # ── fast feedback: everything that needs no services, in parallel ──
  static:
    name: Lint · Typecheck · Unit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm
      - run: npm ci
      - run: npx prisma generate
      - run: npm run lint
      - run: npm run format:check
      - run: npm run typecheck
      - run: npm run test:unit -- --coverage
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: coverage, path: coverage/ }

  # ── real Postgres + real MinIO. No mocks at this layer. ──
  integration:
    name: Integration
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: portal
          POSTGRES_PASSWORD: portal
          POSTGRES_DB: ai_portal_test
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U portal"
          --health-interval 5s --health-timeout 5s --health-retries 10
      minio:
        image: bitnami/minio:latest
        env:
          MINIO_ROOT_USER: minioadmin
          MINIO_ROOT_PASSWORD: minioadmin
          MINIO_DEFAULT_BUCKETS: ai-portal
        ports: ["9000:9000"]
    env:
      DATABASE_URL: postgresql://portal:portal@localhost:5432/ai_portal_test
      S3_ENDPOINT: http://localhost:9000
      S3_BUCKET: ai-portal
      S3_ACCESS_KEY_ID: minioadmin
      S3_SECRET_ACCESS_KEY: minioadmin
      S3_FORCE_PATH_STYLE: "true"
      AUTH_SECRET: test-secret-at-least-32-characters-long
      AUTH_GITHUB_ID: test
      AUTH_GITHUB_SECRET: test
      DOWNLOAD_IP_SALT: test-salt-value
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: npm }
      - run: npm ci
      - run: npx prisma migrate deploy
      # Fails if schema.prisma was edited without generating a migration.
      # This one line prevents the most common solo-dev deploy break.
      - name: Migrations match schema
        run: |
          npx prisma migrate diff \
            --from-migrations prisma/migrations \
            --to-schema-datamodel prisma/schema.prisma \
            --shadow-database-url "$DATABASE_URL" \
            --exit-code
      - run: npm run templates:verify # every template still validates
      - run: npm run test:integration

  build:
    name: Build
    runs-on: ubuntu-latest
    needs: [static]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: npm }
      - run: npm ci
      - run: npx prisma generate
      - run: npm run build
        env:
          DATABASE_URL: postgresql://placeholder:placeholder@localhost:5432/placeholder
          AUTH_SECRET: build-time-placeholder-secret-32-chars
          NEXT_PUBLIC_APP_URL: https://example.com

  security:
    name: Security
    runs-on: ubuntu-latest
    permissions: { security-events: write, contents: read }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: npm }
      - run: npm ci
      - run: npm audit --audit-level=high
      - uses: github/codeql-action/init@v3
        with: { languages: javascript-typescript }
      - uses: github/codeql-action/analyze@v3

  docker:
    name: Docker image
    runs-on: ubuntu-latest
    needs: [build]
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: false
          load: true
          tags: ai-portal:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
      - name: Trivy scan
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ai-portal:${{ github.sha }}
          severity: HIGH,CRITICAL
          exit-code: "1" # a vulnerable image does not merge
```

### Why the jobs are split this way

| Job           | Why separate                                                                     |
| ------------- | -------------------------------------------------------------------------------- |
| `static`      | No services → starts instantly. A lint error surfaces in ~40 s instead of 4 min. |
| `integration` | Needs containers. Runs in parallel with `static`, not after.                     |
| `build`       | Depends only on `static` — no point building code that does not typecheck.       |
| `security`    | Independent; never blocks fast feedback.                                         |
| `docker`      | Slowest. Runs last, cached across builds via GHA cache.                          |

The `prisma migrate diff --exit-code` step deserves special mention: editing
`schema.prisma` and forgetting `migrate dev` is the single most common way a solo
developer ships a build that crashes on boot in production. One CI step eliminates it
permanently.

## 3. GitHub Actions — CD

`.github/workflows/cd.yml`, on push to `main` after CI passes.

```yaml
name: CD
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]

jobs:
  deploy:
    if: github.event.workflow_run.conclusion == 'success'
    runs-on: ubuntu-latest
    environment: production # enables required reviewers + env secrets
    permissions: { contents: read, packages: write }
    steps:
      - uses: actions/checkout@v4

      # 1 ── publish the container image (proof the Docker deliverable is real)
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ghcr.io/${{ github.repository }}:${{ github.sha }}
            ghcr.io/${{ github.repository }}:latest
          cache-from: type=gha

      # 2 ── migrate BEFORE deploying; new code may need the new schema
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: npm }
      - run: npm ci
      - name: Apply migrations
        run: npx prisma migrate deploy
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL_DIRECT }} # unpooled — DDL needs it

      # 3 ── deploy
      - name: Deploy to Vercel
        run: |
          npm i -g vercel@latest
          vercel pull --yes --environment=production --token=${{ secrets.VERCEL_TOKEN }}
          vercel build --prod --token=${{ secrets.VERCEL_TOKEN }}
          vercel deploy --prebuilt --prod --token=${{ secrets.VERCEL_TOKEN }}

      # 4 ── verify, and fail loudly if the deploy is not actually serving
      - name: Smoke test
        run: |
          for i in $(seq 1 10); do
            code=$(curl -s -o /tmp/h.json -w "%{http_code}" "${{ vars.PRODUCTION_URL }}/api/health?deep=1")
            if [ "$code" = "200" ]; then cat /tmp/h.json; exit 0; fi
            echo "attempt $i → $code"; sleep 10
          done
          echo "::error::Smoke test failed after 10 attempts"; exit 1
```

**Rollback:** `vercel rollback` promotes the previous deployment in seconds. Because
migrations are additive (expand/contract), the previous code still runs against the new
schema — which is _why_ the discipline exists. Document this; it is the answer to "what
happens when a deploy goes wrong?"

## 4. Required secrets & variables

| Name                                    | Kind     | Where to get it                                |
| --------------------------------------- | -------- | ---------------------------------------------- |
| `VERCEL_TOKEN`                          | secret   | Vercel → Account Settings → Tokens             |
| `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID`   | secret   | `.vercel/project.json` after `vercel link`     |
| `DATABASE_URL`                          | secret   | Neon **pooled** connection string (runtime)    |
| `DATABASE_URL_DIRECT`                   | secret   | Neon **direct** connection string (migrations) |
| `AUTH_SECRET`                           | secret   | `openssl rand -base64 32` — distinct from dev  |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | secret   | Production GitHub OAuth app                    |
| `S3_*`                                  | secret   | R2 → Manage API Tokens                         |
| `DOWNLOAD_IP_SALT`                      | secret   | `openssl rand -hex 16`                         |
| `PRODUCTION_URL`                        | variable | Your Vercel URL                                |

Never `echo` a secret in a workflow step. GitHub masks known secret values, but a
base64-transformed secret is not masked — that is how they leak.

## 5. Azure DevOps pipeline

`azure-pipelines.yml` at the repo root. The spec's bonus objective; also a genuinely
useful comparison to have opinions about.

```yaml
trigger:
  branches: { include: [main] }
pr:
  branches: { include: [main] }

variables:
  nodeVersion: "22.x"
  imageName: "ai-portal"

stages:
  # ══ CI ══════════════════════════════════════════════════════
  - stage: Validate
    displayName: Lint · Typecheck · Test
    jobs:
      - job: Static
        pool: { vmImage: ubuntu-latest }
        steps:
          - task: NodeTool@0
            inputs: { versionSpec: $(nodeVersion) }
          - task: Cache@2
            inputs:
              key: 'npm | "$(Agent.OS)" | package-lock.json'
              path: $(Pipeline.Workspace)/.npm
          - script: npm ci --cache $(Pipeline.Workspace)/.npm
            displayName: Install
          - script: npx prisma generate
            displayName: Generate Prisma client
          - script: npm run lint && npm run typecheck
            displayName: Lint and typecheck
          - script: npm run test:unit -- --reporter=junit --outputFile=junit.xml
            displayName: Unit tests
          - task: PublishTestResults@2
            condition: succeededOrFailed()
            inputs: { testResultsFiles: junit.xml, testRunTitle: Unit }

      - job: Integration
        pool: { vmImage: ubuntu-latest }
        # Azure DevOps has no first-class `services:` block — start containers manually.
        # This difference is worth being able to explain; see §6.
        steps:
          - script: |
              docker run -d --name pg -p 5432:5432 \
                -e POSTGRES_USER=portal -e POSTGRES_PASSWORD=portal \
                -e POSTGRES_DB=ai_portal_test postgres:16-alpine
              docker run -d --name minio -p 9000:9000 \
                -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
                bitnami/minio:latest
              for i in $(seq 1 30); do docker exec pg pg_isready -U portal && break; sleep 2; done
            displayName: Start Postgres + MinIO
          - task: NodeTool@0
            inputs: { versionSpec: $(nodeVersion) }
          - script: npm ci && npx prisma migrate deploy && npm run test:integration
            displayName: Integration tests
            env:
              DATABASE_URL: postgresql://portal:portal@localhost:5432/ai_portal_test
              S3_ENDPOINT: http://localhost:9000
              S3_BUCKET: ai-portal
              S3_ACCESS_KEY_ID: minioadmin
              S3_SECRET_ACCESS_KEY: $(MINIO_SECRET)
              S3_FORCE_PATH_STYLE: "true"

  # ══ Build ═══════════════════════════════════════════════════
  - stage: Build
    dependsOn: Validate
    condition: succeeded()
    jobs:
      - job: Container
        pool: { vmImage: ubuntu-latest }
        steps:
          - task: Docker@2
            displayName: Build and push image
            inputs:
              containerRegistry: $(dockerRegistryServiceConnection)
              repository: $(imageName)
              command: buildAndPush
              Dockerfile: Dockerfile
              tags: |
                $(Build.SourceVersion)
                latest

  # ══ Deploy ══════════════════════════════════════════════════
  - stage: Deploy
    dependsOn: Build
    condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
    jobs:
      - deployment: Production
        pool: { vmImage: ubuntu-latest }
        environment: production # gives approval gates + deployment history
        strategy:
          runOnce:
            deploy:
              steps:
                - script: npx prisma migrate deploy
                  displayName: Apply migrations
                  env: { DATABASE_URL: $(DATABASE_URL_DIRECT) }
                - task: AzureWebAppContainer@1
                  inputs:
                    azureSubscription: $(azureSubscription)
                    appName: $(webAppName)
                    containers: $(containerRegistry)/$(imageName):$(Build.SourceVersion)
                - script: |
                    curl -fsS --retry 10 --retry-delay 10 --retry-all-errors \
                      "$(PRODUCTION_URL)/api/health?deep=1"
                  displayName: Smoke test
```

> **Be honest about this file.** It is structurally valid and mirrors the GitHub Actions
> pipeline stage for stage, but it is not exercised end-to-end unless you have an Azure
> subscription and a service connection. Say exactly that in the README. A truthful
> "authored and reviewed, not executed against a live Azure subscription" is respected;
> an unqualified "I built an Azure DevOps pipeline" that falls apart under two questions
> is not.

## 6. GitHub Actions vs Azure DevOps — the comparison worth having

| Dimension          | GitHub Actions                             | Azure DevOps                                    |
| ------------------ | ------------------------------------------ | ----------------------------------------------- |
| Config             | Many small workflow files                  | One multi-stage YAML                            |
| Service containers | First-class `services:` with health checks | Manual `docker run` + a wait loop               |
| Approvals          | `environment:` with reviewers              | `environment` + richer gate policies            |
| Secrets            | Repo/org/environment secrets               | Variable groups, Azure Key Vault integration    |
| Free tier          | 2000 min/mo private, unlimited public      | 1800 min/mo, 1 parallel job                     |
| Best at            | OSS, GitHub-native, huge marketplace       | Enterprise governance, audit, Azure integration |

**The answer to "which would you pick?":** GitHub Actions when the code lives on GitHub
and you want speed; Azure DevOps when you need approval gates, Key Vault, and audit trails
that satisfy a compliance team. Naming the _decision criterion_ rather than a favourite is
what makes this a good answer.

## 7. Deployment runbook

### First production deploy

```powershell
# 1. Neon — create the project, copy BOTH connection strings (pooled + direct)
# 2. Cloudflare R2 — create bucket `ai-portal`, PRIVATE, create an API token
#    Add CORS: allow PUT/GET/HEAD from https://<your-app>.vercel.app
# 3. GitHub — create the PRODUCTION OAuth app with the Vercel callback URL
# 4. Vercel
vercel link
vercel env add DATABASE_URL production        # pooled
vercel env add AUTH_SECRET production
# …the rest of the env list from docs/05 §2.3
# 5. Schema + seed (from your machine, using the DIRECT url)
$env:DATABASE_URL = "<direct url>"
npx prisma migrate deploy
npm run db:seed
# 6. Ship
vercel deploy --prod
# 7. Verify
curl https://<app>.vercel.app/api/health?deep=1
```

### Recovery

| Situation     | Command                                                                    |
| ------------- | -------------------------------------------------------------------------- |
| Bad deploy    | `vercel rollback`                                                          |
| Bad migration | Write a **new forward** migration that reverts. Never edit an applied one. |
| Leaked secret | Rotate at the provider → `vercel env rm` + `add` → redeploy                |
| Storage full  | Delete orphaned `staging/` objects; verify the lifecycle rule is active    |

## 8. What "done" looks like

- [ ] `main` protected; PRs required; checks required
- [ ] CI green on a PR in under 5 minutes
- [ ] Merging to `main` deploys with no manual step
- [ ] The image is in GHCR and `docker run` serves the app locally
- [ ] Smoke test fails the pipeline on a broken deploy (test this deliberately)
- [ ] `azure-pipelines.yml` committed with an honest note about its status
- [ ] README has the live URL, the quickstart, and screenshots
