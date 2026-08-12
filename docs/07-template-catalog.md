# 07 — Template Catalog

Deliverable #1 from the problem statement: _"downloadable, ready-to-use boilerplate
templates for creating standard Skills, Plugins, Agents, and MCP Gateways."_

## 1. The rule that makes templates worth building

> **Every template MUST be a valid, immediately publishable component.**

Download the Skill template, change nothing, re-zip it, publish it — and it succeeds.
That property is what turns four zip files into a working ecosystem loop, and it is
mechanically enforced: a CI job unzips each template and runs it through the _real_
`manifestSchema`. A template that drifts out of spec fails the build.

Second rule: **a template must run.** `npm install && npm test` passes out of the box with
one green test. A boilerplate that errors on first run teaches the user that the portal is
unreliable.

## 2. Shared skeleton

Every template archive has this shape. Note there is **no wrapping folder** — this is the
zip root, because `component.json` must be the first thing a reader finds:

```
(archive root)
├── component.json          ← valid manifest, pre-filled with TODO markers
├── README.md               ← becomes the catalog detail page body
├── package.json            ← name matches component.json name
├── tsconfig.json           ┐
├── .gitignore              │
├── scripts/pack.mjs        ├─ from templates/_shared/, merged in at build time
├── docs/                   │
│   └── GETTING-STARTED.md  ┘  ← 5-step "make it yours" guide
├── .env.example            ← names only, never values (omitted where unused)
├── src/
│   └── index.ts            ← the entrypoint declared in the manifest
└── tests/
    └── index.test.ts       ← one passing test
```

In the repository these live in `templates/‹type›/`, with the four shared files factored
out into `templates/_shared/` — see [§4](#4-build--publish-pipeline).

`GETTING-STARTED.md` is identical across all four and is the most-read file in the whole
project:

```markdown
1. Rename it → set `name`, `displayName`, `description`, `author` in component.json
2. Build it → implement src/index.ts
3. Describe it → update README.md (this becomes your catalog page)
4. Verify it → npm test
5. Publish it → zip the folder CONTENTS (not the folder), upload at /publish
```

> **Step 5 is the #1 support issue in every registry ever built.** Users zip the parent
> folder, so `component.json` ends up at `my-skill/component.json` instead of the root,
> and they get `MANIFEST_MISSING` with no idea why. Two mitigations, both cheap:
>
> 1. Ship `scripts/pack.mjs` in every template — `npm run pack` produces a correct zip.
> 2. When `component.json` is found exactly one level deep, return `MANIFEST_MISSING`
>    with the message _"Found component.json at `my-skill/component.json`. Zip the folder
>    **contents**, not the folder itself — or run `npm run pack`."_
>
> That second one takes 10 lines and is the single highest-leverage UX detail in the
> project.

## 3. The four templates

### 3.1 Skill — `skill-template`

**Scenario:** a text-summarization skill.

```json
{
  "$schema": "https://ai-portal.example/api/schemas/component-v1.json",
  "specVersion": "1.0",
  "name": "my-skill",
  "displayName": "My Skill",
  "type": "skill",
  "version": "1.0.0",
  "description": "TODO: describe what this skill does in 10-300 characters.",
  "author": { "name": "TODO: Your Name" },
  "license": "MIT",
  "keywords": ["starter", "skill"],
  "runtime": { "language": "typescript", "minVersion": "20.0.0" },
  "entrypoint": "src/index.ts",
  "skill": {
    "instructions": "SKILL.md",
    "allowedTools": ["read_file"],
    "triggers": ["TODO: a phrase a user would say to invoke this skill"],
    "outputs": [{ "name": "result", "type": "string", "description": "The skill output" }],
    "examples": [
      { "input": "Summarize this article", "output": "A three-sentence summary." }
    ]
  }
}
```

Extra files: `SKILL.md` (the instruction body the agent loads — a commented, structured
prompt with a worked example).

`src/index.ts` exports a typed `execute(input): Promise<Output>` with a working
implementation, not a `throw new Error("not implemented")`.

---

### 3.2 Plugin — `plugin-template`

**Scenario:** a formatting hook plus one slash command.

```json
{
  "specVersion": "1.0",
  "name": "my-plugin",
  "displayName": "My Plugin",
  "type": "plugin",
  "version": "1.0.0",
  "description": "TODO: describe what this plugin extends and how.",
  "author": { "name": "TODO: Your Name" },
  "license": "MIT",
  "keywords": ["starter", "plugin"],
  "runtime": { "language": "typescript", "minVersion": "20.0.0" },
  "entrypoint": "src/index.ts",
  "plugin": {
    "host": "claude-code",
    "hooks": [
      {
        "event": "PostToolUse",
        "matcher": "Write|Edit",
        "handler": "src/hooks/on-write.ts"
      }
    ],
    "commands": [
      {
        "name": "hello",
        "description": "Print a greeting",
        "handler": "src/commands/hello.ts"
      }
    ],
    "permissions": ["filesystem:read"]
  }
}
```

`src/hooks/on-write.ts` demonstrates reading the hook payload from stdin and emitting a
decision on stdout — the actual contract, not pseudocode.

---

### 3.3 Agent — `agent-template`

**Scenario:** a research agent with two tools and a hard iteration cap.

```json
{
  "specVersion": "1.0",
  "name": "my-agent",
  "displayName": "My Agent",
  "type": "agent",
  "version": "1.0.0",
  "description": "TODO: describe the agent's objective and boundaries.",
  "author": { "name": "TODO: Your Name" },
  "license": "MIT",
  "keywords": ["starter", "agent"],
  "runtime": { "language": "typescript", "minVersion": "20.0.0" },
  "entrypoint": "src/index.ts",
  "agent": {
    "systemPrompt": "prompts/system.md",
    "model": {
      "provider": "anthropic",
      "preferred": "claude-sonnet-5",
      "fallback": ["claude-haiku-4-5-20251001"],
      "temperature": 0.2,
      "maxTokens": 8192
    },
    "tools": [
      { "name": "web_search", "source": "builtin" },
      { "name": "read_file", "source": "builtin" }
    ],
    "maxIterations": 10,
    "memory": { "type": "conversation", "maxMessages": 40 },
    "guardrails": { "requireHumanApproval": [], "forbiddenTopics": [] }
  }
}
```

Extra files: `prompts/system.md` — a well-structured system prompt with role, constraints,
output format, and a worked example. This file is a teaching artifact in its own right.

`src/index.ts` implements a real agent loop against the Anthropic Messages API — tool
definitions, the `tool_use` → `tool_result` round trip, and a `maxIterations` guard —
with `ANTHROPIC_API_KEY` read from the environment and named (never valued) in
`.env.example`.

---

### 3.4 MCP Gateway — `mcp-gateway-template`

**Scenario:** a stdio MCP server exposing one read-only tool and one resource. The most
substantial of the four and the one most likely to be genuinely useful to a stranger.

```json
{
  "specVersion": "1.0",
  "name": "my-mcp-gateway",
  "displayName": "My MCP Gateway",
  "type": "mcp-gateway",
  "version": "1.0.0",
  "description": "TODO: describe the system this gateway exposes to MCP clients.",
  "author": { "name": "TODO: Your Name" },
  "license": "MIT",
  "keywords": ["starter", "mcp", "gateway"],
  "runtime": { "language": "typescript", "minVersion": "20.0.0" },
  "entrypoint": "src/server.ts",
  "mcp": {
    "protocolVersion": "2025-06-18",
    "transport": "stdio",
    "command": { "run": "node", "args": ["dist/server.js"] },
    "endpoint": null,
    "auth": { "type": "none", "envVars": [] },
    "tools": [
      {
        "name": "echo",
        "description": "Echo back the provided message",
        "inputSchema": {
          "type": "object",
          "properties": { "message": { "type": "string" } },
          "required": ["message"]
        },
        "readOnly": true
      }
    ],
    "resources": [
      { "uri": "example://readme", "name": "Example resource", "mimeType": "text/plain" }
    ],
    "prompts": []
  }
}
```

`src/server.ts` uses `@modelcontextprotocol/sdk` with `StdioServerTransport`, registers
the `echo` tool and the example resource, and ships `docs/CONNECTING.md` showing the exact
`claude_desktop_config.json` / `.mcp.json` snippet to wire it up. That file turns the
template from a demo into something a stranger can actually use in ten minutes.

## 4. Build & publish pipeline

The pipeline is split across two scripts, at the line where it stops being pure:

**`scripts/build-templates.mts`** — `npm run templates:build`, or `templates:verify` for
steps 1–3 only:

```
for each of the four templates:
  1. read templates/‹type›/ and merge templates/_shared/
  2. VALIDATE component.json against the real manifestSchema   ← fail the build on error
  3. assert every declared path exists (entrypoint, handlers, instructions, systemPrompt)
  4. zip the DIRECTORY CONTENTS (manifest at zip root)          ← the rule users get wrong
  5. compute sha256 + byte size → templates/.dist/ + index.json
```

**`prisma/seed.ts`** — reads `templates/.dist/index.json`:

```
  6. PutObject → templates/{type}/{templateVersion}/{type}-template-{v}.zip
  7. upsert the Template row with real size + checksum
```

Steps 2 and 3 are the point. The templates are validated by the same code path that
validates user uploads — there is exactly one validator, so the templates cannot silently
drift from the spec. `npm run templates:verify` exits non-zero on any breach, which is what
CI gates on.

### Why the split

Steps 1–5 are pure: filesystem in, zip out. Steps 6–7 need a live MinIO **and** a live
Postgres. Keeping them apart means CI can verify all four manifests without starting a
single container, and the seed never re-derives a checksum — it uploads the exact bytes
`index.json` recorded, so the `Template.checksumSha256` row always describes the object
actually in the bucket.

### Two naming details

- The **directories** are `templates/skill/`, not `templates/skill-template/`. The
  `-template` suffix survives where it is user-visible: the archive filename
  (`skill-template-1.0.0.zip`) and the package name inside each manifest.
- The script is `.mts`, not `.mjs`, and runs under `tsx`. It has to be TypeScript to
  import `manifestSchema` itself — a `.mjs` build script could only have re-implemented
  the schema, which is precisely the drift this pipeline exists to prevent.

### `templates/_shared/`

Four files are byte-identical across all four templates — `tsconfig.json`, `.gitignore`,
`scripts/pack.mjs`, `docs/GETTING-STARTED.md` — so they are stored once and merged in at
step 1. A template may override any of them by shipping its own copy. The archive a
developer downloads is complete either way; `tests/unit/templates.test.ts` asserts the
merge actually happened rather than trusting it.

## 5. `/templates` page

Four cards in a responsive grid. Each shows type badge, name, description, size, version,
download count, and a **Download** button.

> **Not yet built: the second "View spec" button.** It was specified here as a deep-link
> to `template.docsUrl` (`/docs/{type}`), but nothing in
> [09](09-implementation-plan.md) builds a `/docs/*` content site — only `/api/docs`
> (Scalar) in task 5.11 — so the link would 404. `docsUrl` is still returned by
> [`GET /api/templates`](03-api-contract.md#32-get-apitemplates-); the button returns when
> the route exists.

Above the grid, a three-step strip: **1. Download a template → 2. Build your component → 3. Publish it back.** Small piece of UI, and it is what makes a visitor understand the
product in five seconds.

Unauthenticated visitors see the cards but get a "Sign in to download" prompt on click,
with `callbackUrl` set so they land back on `/templates` afterwards. Showing the catalog
to logged-out users and gating only the download is the right trade between discovery and
the access-control requirement.

## 6. Template versioning

Templates carry their own `version`, independent of the components built from them.
Bumping a template does not affect anything already published. The seed script is
idempotent — re-running it upserts the row and overwrites the object only when the
checksum changed.
