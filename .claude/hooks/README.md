# Hooks

Wired up in [`../settings.json`](../settings.json). All are PowerShell, since the
development host is Windows 11.

| Hook                                             | Event          | Matcher       |    Blocking?     |
| ------------------------------------------------ | -------------- | ------------- | :--------------: |
| [`protect-sensitive.ps1`](protect-sensitive.ps1) | `PreToolUse`   | `Write\|Edit` | **Yes** (exit 2) |
| [`format-file.ps1`](format-file.ps1)             | `PostToolUse`  | `Write\|Edit` |        No        |
| [`session-brief.ps1`](session-brief.ps1)         | `SessionStart` | —             |        No        |

## `protect-sensitive.ps1`

Blocks writes to files that must never be agent-modified, with an actionable reason:

| Blocked                                            | Instead                                                                                                     |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `.env`, `.env.local`, `.env.production`            | Add the variable to `.env.example`, `src/lib/env.ts`, and `docs/05 §2.3`; the developer sets the real value |
| `prisma/migrations/*/migration.sql`                | Migrations are forward-only — generate a new one                                                            |
| `.next/`, `node_modules/`, `.prisma/`, `coverage/` | Generated output — regenerate it                                                                            |
| `src/components/ui/*.tsx`                          | shadcn primitives are CLI-generated — regenerate or wrap                                                    |

Exit 2 sends the message back to Claude, so it self-corrects rather than just failing.
The hook is written to **fail open** — a malformed stdin payload allows the operation
rather than blocking all work.

## `format-file.ps1`

Runs Prettier on the file just written. Silent no-op before `npm install`. Always exits 0
— a formatter must never block work, and it keeps formatting out of your diffs.

## `session-brief.ps1`

Prints the real project state at session start: whether it is scaffolded, how many
migrations exist, and whether the Docker services are running. Cheap, and it stops a
session from guessing which phase it is in.

## Why there is no `Stop` hook running typecheck

A blocking `Stop` hook that runs `tsc --noEmit` sounds appealing and behaves badly: it
fires on every turn, adds seconds of latency to trivial exchanges, and can trap the
session in a fix-fail loop when an error is outside the current task's scope.

Verification is an explicit action instead — run [`/verify`](../skills/verify/SKILL.md)
when a task is done. That is also when CI would run it.

## Testing a hook by hand

```powershell
'{"tool_input":{"file_path":"e:/AI Portal/.env.local"}}' |
  powershell -NoProfile -File .claude/hooks/protect-sensitive.ps1
echo $LASTEXITCODE   # expect 2
```

```powershell
'{"tool_input":{"file_path":"e:/AI Portal/src/lib/env.ts"}}' |
  powershell -NoProfile -File .claude/hooks/protect-sensitive.ps1
echo $LASTEXITCODE   # expect 0
```

## If a hook misbehaves

Comment its block out of `../settings.json` and say so. A broken hook blocking work is
worse than no hook. Run `claude --debug` to see hook execution and exit codes.
