# My Plugin

> **This file becomes your component's page in the catalog.** Rewrite it for
> someone deciding whether to install your plugin.

A starter Plugin for the AI Component Ecosystem Portal. It ships one working
hook and one working command, so you can see both shapes before writing your
own.

## Quick start

```bash
npm install
npm test        # 10 passing tests
npm run build
```

## What is in the box

### A hook — `src/hooks/guard-secrets.ts`

Runs on `PreToolUse` for `Write` and `Edit`, and blocks any write whose content
matches a credential pattern (GitHub tokens, AWS keys, private keys, database
URLs with inline passwords).

**The hook contract** — this is the part worth understanding:

| Signal        | Meaning                                             |
| ------------- | --------------------------------------------------- |
| Read stdin    | One JSON object describing the tool call            |
| **exit 0**    | Allow                                               |
| **exit 2**    | Block; stderr is shown to the user as the reason    |
| Anything else | Treated as a broken hook — the operation is allowed |

That last row is deliberate. A hook that crashes must **fail open**: bricking
someone's editor is worse than missing one check.

### A command — `src/commands/count-todos.ts`

Invoked by name, receives argv, prints to stdout. Walks the workspace and
reports every `TODO` comment with its file and line.

## The manifest

`component.json` is how the host discovers all of this. Note that `hooks[]` and
`commands[]` name **handler paths relative to the archive root** — the portal
verifies each one actually exists in your upload, so a typo is caught at publish
time rather than at run time.

`permissions` declares what the plugin needs. This one only reads files.

## Making it yours

1. Replace the hook with your own logic — keep `decide()` pure so it stays
   testable without spawning a process.
2. Replace or add commands.
3. Update `component.json`: `hooks[].event`, `matcher`, and every `handler`
   path.
4. `npm run pack`, then upload at `/publish`.

Full walkthrough in [`docs/GETTING-STARTED.md`](docs/GETTING-STARTED.md).

## Licence

MIT.
