---
name: resume
description: Reconstruct project context cheaply at the start of a session — read the state file, check the repo is actually healthy, and report exactly where things stand and what is next. Use when starting a session, returning after a break, or whenever you need to know what to do next without reading the whole spec.
---

# /resume — get oriented in ~4,000 tokens

Rebuild working context from the state file and live repo facts. **Do not read `docs/`
to do this.** If this skill ends with you having read more than one spec section, it has
failed at its job.

## Procedure

### 1. Read the state (2 files, always)

- [`PROJECT-STATE.md`](../../../PROJECT-STATE.md) — phase, done, next, build-time decisions,
  known issues
- [`docs/CONTEXT-MAP.md`](../../../docs/CONTEXT-MAP.md) — which spec sections the next task needs

### 2. Verify the state file is telling the truth

State files drift. Check the claims against reality before trusting them:

```powershell
npm run gate           # format + lint + typecheck + unit — the real health check
npm run test:matrix    # feature coverage; compare with what PROJECT-STATE claims
git status --short     # uncommitted work from last session?
git log --oneline -5   # what actually landed
docker compose ps      # are the dependencies up?
```

If the state file and reality disagree, **reality wins** — fix the state file first and
say that you did.

### 3. Load only what the next task needs

Look up the next task's row in `docs/CONTEXT-MAP.md`. Read those sections. Nothing else.

### 4. Report

```
## Resume — Phase 0 · Foundation

State (PROJECT-STATE.md, updated 2026-08-09)
  Last done:  0.12 npm scripts
  Next task:  0.5 docker-compose.yml
  Blockers:   Docker not installed on this machine

Reality check
  ✓ typecheck clean   ✓ lint clean   ✓ 14 unit tests pass
  ✓ working tree clean, last commit "chore: toolchain gate"
  ⛔ docker not on PATH — task 0.5 cannot be verified locally
  ⚠ state file says fixtures built; confirmed 11 present

To do task 0.5 I need: docs/05 §2 (1,400 words). Loading that only.

Ready. Shall I start 0.5, or is Docker installation happening first?
```

## Rules

- **Never** read all of `docs/` "to get oriented". That is the exact failure this
  framework exists to prevent.
- **Never** trust the state file over a command's output.
- If `PROJECT-STATE.md` is stale (e.g. it claims a task is next that git shows as done),
  update it as part of resuming and say so.
- End with a concrete question or a concrete next action, not a summary.

## Updating state when a task finishes

Four lines, at the end of every task — this is what makes the next session cheap:

```yaml
---
phase: P1
phase_name: Authentication
last_task: "1.4 — Auth.js config with role on the JWT"
next_task: "1.5 — /api/auth/[...nextauth] route handler"
blocked_by: none
updated: 2026-08-12
---
```

Plus: tick the task in **Done**, and add a row to **Decisions made during the build** if
you decided anything that is not already in `docs/`.
