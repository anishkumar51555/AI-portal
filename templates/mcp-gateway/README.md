# My MCP Gateway

> **This file becomes your component's page in the catalog.** Rewrite it for
> someone deciding whether to connect your gateway.

A starter MCP Gateway for the AI Component Ecosystem Portal. It runs a real
[Model Context Protocol](https://modelcontextprotocol.io) server over stdio,
exposing two tools and one resource against a small note store.

## Quick start

```bash
npm install
npm test          # 8 passing tests
npm run build
```

Then wire it into a client — [`docs/CONNECTING.md`](docs/CONNECTING.md) has the
exact config snippets for Claude Desktop and Claude Code, and a troubleshooting
table.

## What is in the box

| Piece          | Kind     | Purpose                                        |
| -------------- | -------- | ---------------------------------------------- |
| `search_notes` | Tool     | Read-only keyword search over the notes        |
| `add_note`     | Tool     | Stores a new note (mutating)                   |
| `notes://all`  | Resource | Every note as JSON                             |
| `src/store.ts` | Domain   | The note store — replace this with your system |

**Tools are verbs, resources are nouns.** Use a resource when the client wants
to pull context; a tool when it wants something done.

## The one rule that will bite you

**On a stdio transport, stdout is the protocol channel.** A single stray
`console.log` corrupts the JSON-RPC stream, and the client disconnects with a
parse error that points nowhere near the real cause. Every log in this template
goes to `console.error`. Keep it that way.

## Making it yours

1. Replace `src/store.ts` with your database, HTTP API, or filesystem access.
2. Rewrite the tools in `src/server.ts` — keep the shape, change the bodies.
3. Update `component.json`: `mcp.tools[]`, `mcp.resources[]`, and
   `mcp.auth.envVars` (**names only** — the portal rejects manifests containing
   anything that looks like a credential).
4. `npm run pack`, then upload at `/publish`.

### Tool descriptions are the main lever

The model decides whether to call a tool almost entirely from its description.
Say **when** to call it, not just what it does:

```
✅ "Search the note collection by keyword... Call this when the user asks what
    is in their notes, or asks a question the notes might answer."

❌ "Searches notes."
```

### stdio vs http

This template uses `transport: "stdio"` — the client spawns your process. For a
gateway that runs as a service instead, set `transport` to `"http"` or `"sse"`
and provide `endpoint` (https only) rather than `command`. The manifest schema
enforces exactly one of the two.

## Licence

MIT.
