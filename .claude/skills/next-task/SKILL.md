---
name: next-task
description: Pick up the next task from the implementation plan and execute it correctly — read the referenced spec sections first, implement only that task, verify against its acceptance criteria. Use whenever the developer says "next", "continue", or names a task number like 3.7.
---

# /next-task — execute one plan task properly

The failure mode this prevents: generating plausible code that does not match the written
contract. The cure is reading the spec **before** writing, every time.

## Procedure

### 1. Identify the task

If a number was given (`3.7`), use it. Otherwise open
[`docs/09-implementation-plan.md`](../../../docs/09-implementation-plan.md), find the
first task in the current phase whose acceptance criteria are not yet met, and **state
which task you picked and why** before doing anything else.

### 2. Read the spec — non-negotiable

Every task row carries a spec reference. Read those sections in full, plus:

- `.claude/rules/` — all of them apply
- `docs/03-api-contract.md` if the task touches an endpoint
- `docs/08-security-model.md` if it touches upload, auth, or rendering

Do not skip this because the task looks small. Task 2.8 looks like "add two routes" and
has a precise documented response shape you will otherwise invent.

### 3. Restate before building

In three lines:

- what you are building, and in which files
- which contract it must satisfy (quote the shape)
- anything the spec does **not** say that you need to decide

**If the third line is non-empty, stop and ask.** Do not invent a contract.

### 4. Implement — only this task

- Touch only the files this task needs.
- Follow the layer rules in `.claude/rules/20-architecture-boundaries.md`.
- Zod-parse every input; call a guard on every protected path.
- Write the test alongside if the task touches `domain/` or `server/services/`.
- Do not refactor unrelated code. Do not add a dependency without saying why.

### 5. Verify against the acceptance criteria

Run the task's stated criterion literally. "Download 302s to a presigned URL; the file
opens" means actually following the redirect, not reading the code and concluding it
probably works.

Then run [`/verify`](../verify/SKILL.md).

### 6. Report

```
## Task 3.7 — component.service.publish()

Files
  + src/server/services/component.service.ts
  + tests/integration/publish.test.ts
  ~ src/server/repositories/component.repository.ts

Contract
  docs/04 Flow 3 ordering, docs/03 §3.7 response shape

Acceptance: "staging deleted on both success and failure"
  ✓ verified by tests/integration/publish.test.ts:44 and :71

Verification
  ✓ lint  ✓ typecheck  ✓ unit (12)  ✓ integration (4)

Decisions
  - CopyObject happens before $transaction opens, per docs/01 §5.2 —
    an orphaned object is safer than a catalog row with no file.

Not done
  - Rate limiting is task 3.6, not this one.
```

## Rules

- **One task.** If you notice something else broken, report it; do not fix it inside this
  task.
- **Never report done with a failing check.** Say what fails.
- If the spec is wrong or contradicts itself, stop and say so — the fix is to the doc
  first, then the code.
- Explain any non-obvious choice in one sentence. The developer must be able to defend
  every line in an interview.
