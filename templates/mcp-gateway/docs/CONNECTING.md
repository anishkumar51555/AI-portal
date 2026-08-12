# Connecting this gateway to a client

This is what turns the template from a demo into something a stranger can use in
ten minutes. Build first:

```bash
npm install
npm run build     # produces dist/server.js — the file clients actually run
```

## Claude Desktop

Edit the config file:

| OS      | Path                                                              |
| ------- | ----------------------------------------------------------------- |
| macOS   | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json`                     |
| Linux   | `~/.config/Claude/claude_desktop_config.json`                     |

```json
{
  "mcpServers": {
    "my-mcp-gateway": {
      "command": "node",
      "args": ["/absolute/path/to/my-mcp-gateway/dist/server.js"]
    }
  }
}
```

**Use an absolute path.** The client does not run from your project directory,
so a relative path resolves somewhere unexpected and the server never starts.

Restart Claude Desktop, then ask: _"Search my notes for portal."_

## Claude Code

Add a `.mcp.json` at your project root:

```json
{
  "mcpServers": {
    "my-mcp-gateway": {
      "command": "node",
      "args": ["./dist/server.js"]
    }
  }
}
```

Then `/mcp` lists the server and its tools.

## Passing configuration

Secrets go in `env`, by name, never inline in the args:

```json
{
  "mcpServers": {
    "my-mcp-gateway": {
      "command": "node",
      "args": ["/abs/path/dist/server.js"],
      "env": {
        "DATABASE_URL": "postgresql://..."
      }
    }
  }
}
```

Declare the **names** in `component.json` under `mcp.auth.envVars` — never the
values. The portal rejects a manifest containing anything that looks like a
credential.

## Verifying it by hand

An MCP server over stdio speaks JSON-RPC on stdin/stdout, so you can drive it
with a pipe:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/server.js
```

You should get a JSON response listing `search_notes` and `add_note`.

## When it doesn't work

| Symptom                           | Cause                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Client shows the server as failed | Path is wrong or relative. Use an absolute path and confirm `dist/server.js` exists.                   |
| "Unexpected token" / parse errors | Something wrote to **stdout**. On stdio, stdout is the protocol channel — every log must go to stderr. |
| Server starts, no tools appear    | `npm run build` wasn't re-run after editing `src/`.                                                    |
| Tools appear but never get called | The tool `description` doesn't say _when_ to use it. That phrasing is the main lever.                  |

That second row is the one that costs people an afternoon. A single stray
`console.log` corrupts the JSON-RPC stream and the client disconnects with an
error that points nowhere near the real cause.
