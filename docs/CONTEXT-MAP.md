# Context Map — what to read, and only that

**The problem this solves.** `docs/` is ~36,000 words. Reading it every session
burns context on material irrelevant to the task at hand, and a session that runs
out of context mid-task is worse than one that started slightly less informed.

**The rule.** Load `CLAUDE.md` + `PROJECT-STATE.md` (automatic, ~1,200 words), then
**exactly one row** from the table below. Nothing else unless the task forces it.

---

## The lookup table

| Working on…                               | Read exactly this                                                              | Approx. words |
| ----------------------------------------- | ------------------------------------------------------------------------------ | ------------- |
| **Picking up work / "what's next"**       | `PROJECT-STATE.md` only                                                        | 500           |
| **Env vars, config, boot validation**     | `docs/05` §2.3                                                                 | 600           |
| **Docker, Compose, local setup**          | `docs/05` §2                                                                   | 1,400         |
| **Deployment, prod topology, Dockerfile** | `docs/05` §3, §5                                                               | 1,600         |
| **Auth, sessions, login**                 | `docs/04` Flow 1 + `docs/08` §2 + `rules/50-security.md`                       | 2,200         |
| **Any API endpoint**                      | `docs/03` (the one endpoint's section) + §1 + `rules/30-api-and-validation.md` | 1,800         |
| **Database schema change**                | `docs/02` §2–3 + `rules/40-database-and-prisma.md`                             | 2,400         |
| **Search / catalog queries**              | `docs/02` §4 + `docs/03` §3.4                                                  | 1,300         |
| **Manifest schema / validation**          | `docs/06` §3–5 + `rules/30-api-and-validation.md`                              | 3,000         |
| **Archive inspection / upload safety**    | `docs/08` §4 + `docs/04` Flow 3                                                | 2,600         |
| **Publish pipeline end to end**           | `docs/04` Flow 3 + `docs/03` §3.6–3.8 + `docs/01` §5.2                         | 3,400         |
| **Templates**                             | `docs/07`                                                                      | 1,800         |
| **Any UI / page / component**             | `docs/01` §6 + `rules/60-ui-and-accessibility.md`                              | 1,700         |
| **Writing tests**                         | `docs/11` (the relevant level) + `tests/feature-map.ts`                        | 2,000         |
| **CI/CD pipeline**                        | `docs/10` §2–3                                                                 | 2,200         |
| **"Why is it like this?"**                | `docs/adr/README.md`, then the one ADR                                         | 400 + 700     |

## Always in effect, never needs loading

These are enforced by machinery, not by remembering to read a file:

| Rule                                                                               | Enforced by                                                |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Layer boundaries (`app/` ↛ Prisma, services ↛ `next/*`, `domain/` imports nothing) | `eslint.config.mjs` — `npm run lint` fails                 |
| No `any`, no unused vars, no `console.log`                                         | ESLint                                                     |
| Strict types, `noUncheckedIndexedAccess`                                           | `tsconfig.json` — `npm run typecheck` fails                |
| Formatting                                                                         | Prettier + the `format-file` PostToolUse hook              |
| No edits to `.env*`, applied migrations, generated dirs                            | `protect-sensitive` PreToolUse hook — blocks with a reason |
| Coverage floors on the validator and inspector                                     | `vitest.config.ts` thresholds                              |
| Every feature has a test                                                           | `npm run test:matrix -- --gate P3`                         |

**This is the point.** Rules that live only in a prompt get forgotten as context
fills. Rules that live in tooling hold regardless. The eight non-negotiables that
_cannot_ be mechanically checked stay inline in `CLAUDE.md`, where they are cheap.

## When to break the rule

Read more than one row when:

- The task genuinely spans areas (the publish pipeline touches storage, validation,
  and the database — its row already reflects that).
- A spec section contradicts itself or the code. Then read wider, and fix the doc.
- You are about to invent a contract the docs do not define. **Stop and ask instead.**

Do **not** read wider because the task "feels big". Task 3.1 is one file.

## Cost of getting this wrong

| Approach                      | Context used before the first line of code |
| ----------------------------- | ------------------------------------------ |
| Read all of `docs/`           | ~48,000 tokens                             |
| Read all `.claude/rules/` too | ~62,000 tokens                             |
| **This map**                  | **~4,000 tokens**                          |

The saving is not the point on its own — the point is that the remaining context
goes to the actual code, its tests, and the errors they produce.
