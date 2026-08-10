# Project skills

Four workflows, each encoding a procedure that is easy to get wrong under time pressure.

| Skill                                   | Invoke                           | Use when                                         |
| --------------------------------------- | -------------------------------- | ------------------------------------------------ |
| [`next-task`](next-task/SKILL.md)       | `/next-task` or `/next-task 3.7` | Starting any task from the implementation plan   |
| [`verify`](verify/SKILL.md)             | `/verify`                        | A task is finished, or before committing         |
| [`db-change`](db-change/SKILL.md)       | `/db-change`                     | Changing anything in `prisma/schema.prisma`      |
| [`new-endpoint`](new-endpoint/SKILL.md) | `/new-endpoint`                  | Adding or changing anything under `src/app/api/` |

## The daily loop

```
/next-task          → picks the task, reads the spec, implements it
/verify             → runs the same gate CI runs
git commit          → conventional commit
```

For a schema change, `/db-change` goes inside step 1. For an endpoint,
`/new-endpoint` does.

## Why these four

Each prevents a specific, likely failure:

| Skill          | Failure it prevents                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------ |
| `next-task`    | Generating plausible code that does not match the written contract, because the spec was skimmed |
| `verify`       | Reporting "done" on code that does not compile — the most damaging kind of false progress        |
| `db-change`    | Editing `schema.prisma` without a migration, then shipping a build that crashes on boot          |
| `new-endpoint` | Inventing a response shape that the frontend then has to be bent around                          |

They are procedural, not informational. Reference material belongs in
[`docs/`](../../docs/README.md); rules belong in [`.claude/rules/`](../rules/).
