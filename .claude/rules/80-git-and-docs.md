# Rule 80 — Git & documentation

## Commits

Conventional Commits. Not optional — the changelog is generated from them.

```
<type>(<scope>): <imperative summary, lower case, no trailing period>

[optional body: why, not what]
```

| Type       | For                           |
| ---------- | ----------------------------- |
| `feat`     | A user-visible capability     |
| `fix`      | A bug fix                     |
| `refactor` | Behaviour-preserving change   |
| `test`     | Tests only                    |
| `docs`     | Documentation only            |
| `chore`    | Tooling, dependencies, config |
| `ci`       | Pipeline changes              |
| `perf`     | Performance                   |

Scopes: `auth` `catalog` `publish` `manifest` `storage` `db` `templates` `ui` `api`
`docker` `ci` `docs`.

```
feat(manifest): add discriminated union for the four component types
fix(storage): use path-style addressing so MinIO presigning works
docs(adr): record the two-phase upload decision
```

**One logical change per commit.** If the message needs "and", it is two commits.

## Branches

`main` is protected and always deployable. Work on short-lived branches:
`feat/manifest-validator`, `fix/staging-cleanup`, `docs/adr-011`. Merge within a day or
two; a week-old branch is a merge conflict waiting to happen.

## Never commit

- `.env`, `.env.local`, or any file with a real secret
- `node_modules/`, `.next/`, `coverage/`, `playwright-report/`
- A `.zip` outside `tests/fixtures/`
- Commented-out blocks of code — git remembers, delete it
- `console.log` — use the pino logger
- `test.only` / `describe.only`
- A `TODO` without an owner and a reason

Verify once, early: `git log --all --full-history -- .env*` must return nothing.

## Docs are part of the change

| Changing                         | Update, in the same commit                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| An endpoint's shape              | [`docs/03-api-contract.md`](../../docs/03-api-contract.md)                                  |
| The database schema              | [`docs/02-data-model.md`](../../docs/02-data-model.md) + a migration                        |
| The manifest schema              | [`docs/06-component-manifest-spec.md`](../../docs/06-component-manifest-spec.md)            |
| A flow's behaviour               | [`docs/04-sequence-flows.md`](../../docs/04-sequence-flows.md)                              |
| Env vars                         | `.env.example` + [`docs/05 §2.3`](../../docs/05-infrastructure.md#23-environment-variables) |
| A significant technical decision | A new ADR in [`docs/adr/`](../../docs/adr/)                                                 |

**A code change that contradicts a doc without updating it is an incomplete change.**

## When to write an ADR

Write one when the decision:

- affects more than one module, **or**
- was a close call between real alternatives, **or**
- someone will later ask "why is it like this?"

One decision per ADR. Numbers are permanent. An accepted ADR is immutable — supersede it,
never edit it. Always fill in the negative consequences; an ADR with no downsides listed
is marketing.

## Task completion

A task from [`docs/09-implementation-plan.md`](../../docs/09-implementation-plan.md) is
done when:

1. `npm run lint` clean
2. `npm run typecheck` clean
3. `npm run test` passes
4. Its acceptance criteria are met
5. Docs updated if behaviour changed
6. Committed with a Conventional Commit message

Report honestly. If something is partially done, say which part and why. Never report a
task complete when a test is failing or a criterion is unmet.
