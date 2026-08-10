# Project subagents

Three agents, each with a job the main session does worse. All are **read-only** by
design — they analyse and report; you decide and edit.

| Agent                                     | Use it when                                                                      | Typical trigger                                    |
| ----------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------- |
| [`spec-auditor`](spec-auditor.md)         | You finished a task or a phase and want to know whether the code matches `docs/` | End of Phase 2, 3, 4                               |
| [`security-auditor`](security-auditor.md) | You touched upload, auth, or user-content rendering                              | End of Phase 1 and Phase 3; once before deploy     |
| [`explainer`](explainer.md)               | Code exists that you could not explain out loud in an interview                  | After any feature you did not fully write yourself |

## How to invoke

```
Use the spec-auditor agent to check the publish pipeline against docs/03 §3.7
and docs/04 Flow 3.
```

```
Use the security-auditor agent to review everything under
src/server/services/ and src/app/api/uploads/.
```

```
Use the explainer agent on src/server/services/archive.inspector.ts.
```

## Why these three and not more

A subagent starts with no context and has to rediscover the codebase, so it earns its cost
only when the task is (a) genuinely separable and (b) better done with fresh eyes than
with the main session's accumulated assumptions.

Auditing your own work in the same session that produced it is exactly the case where
fresh eyes help — you inherit your own blind spots otherwise. Explaining code is the same
in reverse: the session that wrote it will over-assume what you already know.

Everything else — writing endpoints, building UI, running migrations — is better done
inline, where the accumulated context is an asset rather than an overhead.
