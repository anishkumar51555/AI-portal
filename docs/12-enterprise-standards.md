# 12 — Enterprise Standards

You asked for enterprise-level standards. Here they are, split by return on effort so you
can spend your 17 days where they buy the most.

## 0. Priority summary

| Tier       | Practice                                       | Effort | Why it pays                                                                        |
| ---------- | ---------------------------------------------- | :----: | ---------------------------------------------------------------------------------- |
| **★ Must** | ADRs                                           |  2 h   | The single highest signal-per-hour item in this list                               |
| **★ Must** | Conventional Commits                           |  0 h   | Free. Just type differently.                                                       |
| **★ Must** | Boot-time config validation                    |  1 h   | Turns a class of 3 a.m. bugs into a startup crash                                  |
| **★ Must** | Error taxonomy + envelope                      |  2 h   | Every senior reviewer checks the error contract                                    |
| **★ Must** | Structured logging + request ids               |  2 h   | The difference between "debuggable" and "not"                                      |
| **★ Must** | Health endpoints                               |  1 h   | Container orchestration table stakes                                               |
| **★ Must** | Non-root container, multi-stage                |  1 h   | The first thing a reviewer greps the Dockerfile for                                |
| **★ Must** | Branch protection + PR template                |  1 h   | Discipline, visible in the repo's history                                          |
| **☆ High** | OpenAPI spec                                   |  3 h   | "I wrote endpoints" → "I published a contract"                                     |
| **☆ High** | Dependabot + CodeQL + Trivy                    |  1 h   | Supply-chain awareness, mostly configuration                                       |
| **☆ High** | Graceful degradation + retries                 |  2 h   | Shows you think about failure                                                      |
| **☆ High** | Accessibility pass                             |  3 h   | Rarely done by students; instantly noticed                                         |
| **☆ High** | CODEOWNERS + issue templates                   | 0.5 h  | Repo looks maintained                                                              |
| **◇ Nice** | SLOs in the README                             |  1 h   | Only if measured — an unmeasured SLO is a lie                                      |
| **◇ Nice** | Feature flags                                  |  2 h   | Overkill at this size; skip unless it's free                                       |
| **◇ Nice** | SBOM generation                                |  1 h   | Impressive but niche                                                               |
| **✗ Skip** | Kubernetes, service mesh, event sourcing, CQRS |   —    | Resume-driven architecture. A reviewer will read it as inexperience, not ambition. |

The last row matters as much as the others. **Knowing what not to build is a senior
skill**, and a 3-week project running Kubernetes reads as someone who cannot judge scope.

---

## 1. Architecture Decision Records

The highest-value practice on this list, and the one almost no student portfolio has.

An ADR is a one-page record of a decision: context, options, choice, consequences. It
makes your reasoning inspectable. Ten short ADRs will do more for you in an interview than
another feature — the interviewer stops asking _"can you code?"_ and starts asking
_"tell me about ADR-003."_ That is a fundamentally better conversation.

Format in [`adr/ADR-000-template.md`](adr/ADR-000-template.md). Written for this project:
[001](adr/ADR-001-fullstack-framework.md)–[010](adr/ADR-010-two-phase-upload.md).

**Rules:** one decision per ADR · numbered, never renumbered · never edited after
acceptance (supersede instead) · written _at the time of the decision_, not backfilled.

## 2. Configuration — 12-Factor

| Factor                    | Applied                                                                 |
| ------------------------- | ----------------------------------------------------------------------- |
| Config in the environment | Every environment-dependent value is an env var. Zero hard-coded URLs.  |
| Validated at boot         | `env.ts` Zod-parses on startup; the process refuses to start if invalid |
| Dev/prod parity           | Same Postgres major, same S3 API in both                                |
| Backing services attached | Database and storage are URLs, swappable without a code change          |
| Stateless processes       | No local disk state; a container can be killed at any moment            |
| Logs to stdout            | The platform handles aggregation, not the app                           |

**The rule to internalize:** if a value differs between your laptop and production, it is
an env var. If it does not, it is a constant in code. Never a magic literal in a service.

## 3. API design

| Standard                  | Applied                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| Resource-oriented REST    | `/api/components/:slug/versions` — nouns, hierarchy, no verbs in paths                         |
| Correct status codes      | 201 on create, 204 on delete, 409 on conflict, 422 on semantic failure, 429 with `Retry-After` |
| Consistent error envelope | One shape, everywhere. Machine-readable `code`, human `message`, field-level `details`.        |
| Request correlation       | `X-Request-Id` on every response and every log line                                            |
| Pagination                | Explicit, with a `total` and `totalPages`                                                      |
| Versioning strategy       | Manifest carries `specVersion`; the HTTP API would go to `/api/v2` if it broke                 |
| Documented                | OpenAPI 3.1 generated from the same Zod schemas that validate                                  |
| Rate limited              | Documented per-endpoint, with standard headers                                                 |

**The 422-vs-400 distinction** is a small thing that reads as care: 400 means "I could not
parse this", 422 means "I parsed it and it is semantically wrong". A malformed JSON body
is 400; a valid JSON manifest with `version: "1.0"` is 422.

## 4. Error handling

```ts
// src/domain/errors.ts
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly status: number,
    message?: string,
    public readonly details?: FieldError[],
  ) {
    super(message ?? code);
    this.name = "AppError";
  }
}

// One handler. Every route wraps in it. No try/catch scattered through handlers.
export function toResponse(err: unknown, requestId: string): NextResponse {
  if (err instanceof AppError) {
    logger.warn({ requestId, code: err.code, status: err.status }, "handled error");
    return NextResponse.json(
      { error: { code: err.code, message: err.message, details: err.details }, requestId },
      { status: err.status, headers: { "X-Request-Id": requestId } },
    );
  }
  // Unknown: log everything, tell the user nothing.
  logger.error({ requestId, err }, "unhandled error");
  return NextResponse.json(
    {
      error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." },
      requestId,
    },
    { status: 500, headers: { "X-Request-Id": requestId } },
  );
}
```

**Principles:** fail fast at boundaries · never leak internals in a 500 · always return a
`requestId` so a user can quote it · log at the boundary, not at every layer (duplicate
logs make an incident harder, not easier).

## 5. Logging

```ts
logger.info(
  {
    requestId,
    userId,
    action: "component.publish",
    slug,
    version,
    sizeBytes,
    durationMs,
  },
  "component published",
);
```

| Rule                                                       | Reason                                                                                                               |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Structured JSON, never string concatenation                | Queryable. `logger.info("user " + id + " did x")` is unsearchable.                                                   |
| `requestId` on every line                                  | One request's story is one filter away                                                                               |
| Never log secrets, tokens, raw IPs, or full request bodies | Logs leak; assume they will be read by someone who should not                                                        |
| Levels mean something                                      | `error` = a human should look · `warn` = handled but notable · `info` = business events · `debug` = development only |
| Log business events, not control flow                      | "component published" is useful; "entering function" is noise                                                        |

## 6. Observability

Three questions any system should answer, with the cheapest thing that answers each:

| Question                       | Mechanism                                             |
| ------------------------------ | ----------------------------------------------------- |
| Is it up?                      | `GET /api/health` + the container `HEALTHCHECK`       |
| Are its dependencies healthy?  | `GET /api/health?deep=1` (database + storage latency) |
| What went wrong for this user? | `requestId` → structured logs → Sentry                |

Sentry's free tier gives errors and basic tracing. Add it in Phase 5 and verify with a
deliberate throw. Skip custom metrics and dashboards — without traffic they are theatre.

## 7. Documentation as a deliverable

| Artifact               | Purpose                                                            |
| ---------------------- | ------------------------------------------------------------------ |
| `README.md`            | Live link, screenshots, 10-minute quickstart, architecture diagram |
| `docs/`                | This set — the design record                                       |
| `adr/`                 | The decision record                                                |
| `CONTRIBUTING.md`      | Branching, commits, how to run tests                               |
| `.env.example`         | Every variable, commented, no values                               |
| OpenAPI at `/api/docs` | Executable API documentation                                       |
| `CHANGELOG.md`         | Generated from Conventional Commits                                |

**The README test:** hand the repo to a friend who has never seen it. If they cannot get
it running in 10 minutes without asking you a question, the README is incomplete. Actually
run this test.

## 8. Code quality gates

| Gate                     | Tool                                                           | Blocking |
| ------------------------ | -------------------------------------------------------------- | :------: |
| Formatting               | Prettier `--check`                                             |    ✅    |
| Linting                  | ESLint flat config + `jsx-a11y` + `import/no-restricted-paths` |    ✅    |
| Types                    | `tsc --noEmit`, `strict: true`                                 |    ✅    |
| Unit + integration tests | Vitest                                                         |    ✅    |
| Coverage thresholds      | Vitest v8                                                      |    ✅    |
| Schema/migration drift   | `prisma migrate diff --exit-code`                              |    ✅    |
| Template validity        | `npm run templates:verify`                                     |    ✅    |
| Dependency CVEs          | `npm audit --audit-level=high`                                 |    ✅    |
| Static analysis          | CodeQL                                                         |    ✅    |
| Image CVEs               | Trivy (HIGH/CRITICAL)                                          |    ✅    |

**TypeScript config — non-negotiable:**

```jsonc
{
  "strict": true,
  "noUncheckedIndexedAccess": true, // arr[0] is T | undefined. Catches real bugs.
  "noImplicitOverride": true,
  "noFallthroughCasesInSwitch": true,
  "forceConsistentCasingInFileNames": true, // Windows dev → Linux CI. Non-optional.
}
```

`noUncheckedIndexedAccess` will annoy you for two days and then prevent a production
crash. Keep it on. The casing flag is not optional when you develop on Windows and deploy
to Linux — a `Button.tsx` imported as `button.tsx` works locally and fails in CI.

## 9. Accessibility

Rarely done in student projects, immediately visible, and legally required in most
enterprises.

| Requirement        | How                                                               |
| ------------------ | ----------------------------------------------------------------- |
| Keyboard navigable | Radix primitives handle focus traps; tab through every page once  |
| Visible focus      | Never `outline: none` without a replacement                       |
| Semantic HTML      | `<nav> <main> <article> <button>`. A clickable `<div>` is a bug.  |
| Alt text           | Every image, including avatars                                    |
| Colour contrast    | 4.5:1 body, 3:1 large text. Check with DevTools.                  |
| Form labels        | Every input has a `<label>`; errors linked via `aria-describedby` |
| Live regions       | Upload progress and toasts announced via `aria-live`              |
| Reduced motion     | Respect `prefers-reduced-motion`                                  |

Automate what you can with `eslint-plugin-jsx-a11y`; do one manual keyboard pass per page.

## 10. Repository hygiene

```
.github/
├── workflows/{ci,cd}.yml
├── ISSUE_TEMPLATE/{bug_report,feature_request}.yml
├── PULL_REQUEST_TEMPLATE.md
├── dependabot.yml
└── CODEOWNERS
CONTRIBUTING.md · LICENSE (MIT) · SECURITY.md · CHANGELOG.md
```

`SECURITY.md` matters more than it looks: a registry that accepts uploads _needs_ a
documented way to report a malicious component. Its presence signals you understood what
you built.

## 11. Data & privacy

| Principle                    | Applied                                                              |
| ---------------------------- | -------------------------------------------------------------------- |
| Minimization                 | Only email, name, avatar, and GitHub login. IPs hashed.              |
| Purpose limitation           | Download records exist for abuse detection and counts. Nothing else. |
| Right to erasure             | A hard-delete script exists alongside the default soft delete        |
| Encryption in transit        | TLS everywhere; `https` enforced in manifests                        |
| Encryption at rest           | Provided by Neon and R2                                              |
| No secrets at rest in the DB | OAuth tokens are the only sensitive stored values, server-read only  |

## 12. What a reviewer will actually check first

From experience, in order:

1. `README.md` — does it explain itself in 30 seconds?
2. Folder structure — is there a shape, or is everything in `app/`?
3. One route handler — is input validated? is auth checked? is the error shape consistent?
4. The Dockerfile — multi-stage? non-root? `.dockerignore`?
5. A test file — does it test behaviour, or does it test mocks?
6. Commit history — atomic and readable, or "update" ×40?
7. `.env.example` — present, and is `.env` genuinely absent from history?

Every one of those is cheap to get right and expensive to fix later. Get them right from
commit one.
