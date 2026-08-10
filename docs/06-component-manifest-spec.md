# 06 — Component Manifest Specification v1.0

> **This is the core intellectual property of the project.** Everything else — the
> catalog, the upload wizard, the templates — is an interface to this contract. Build it
> first, build it carefully, and lead with it when you present the project.

## 1. Why a manifest exists

Without a machine-readable contract, a registry is a file host with a search box. With
one, it can:

- **Reject** malformed components at the gate, with precise field-level errors.
- **Index** components by type, capability, runtime, and tag without parsing code.
- **Render** rich, structured detail pages instead of a README dump.
- **Enable tooling** — an IDE can autocomplete a manifest against the published JSON
  Schema; a future CLI can scaffold and lint against the same spec.
- **Evolve safely** — `specVersion` lets v2 arrive without invalidating v1 components.

Every one of those follows from one file. That leverage is the argument.

## 2. Contract summary

| Rule         | Value                                                                          |
| ------------ | ------------------------------------------------------------------------------ |
| File name    | `component.json`                                                               |
| Location     | **Archive root.** Not in a subdirectory.                                       |
| Encoding     | UTF-8, no BOM                                                                  |
| Format       | JSON (not JSON5, not YAML, no comments)                                        |
| Max size     | 64 KB                                                                          |
| Spec version | `"1.0"` — the only accepted value in v1                                        |
| Validation   | Zod discriminated union on `type`; **all unknown keys rejected** (`.strict()`) |

> **Why `.strict()` and not `.passthrough()`.** A typo like `"decsription"` should be a
> loud error at publish time, not a silently missing field discovered by a user three
> weeks later. Strict rejection is unforgiving and correct for a registry. State this as a
> deliberate choice — it is the kind of small decision that reads as senior.

## 3. Base schema — common to all four types

```jsonc
{
  "$schema": "https://ai-portal.example/api/schemas/component-v1.json",
  "specVersion": "1.0",

  "name": "pdf-extractor", // ^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$
  "displayName": "PDF Extractor", // 1–80 chars, human-facing
  "type": "skill", // skill | plugin | agent | mcp-gateway
  "version": "1.0.0", // strict semver, no range, no "v" prefix
  "description": "Extracts structured text and tables from PDF documents.", // 10–300

  "author": {
    "name": "Anish Kumar", // required
    "email": "anish@example.com", // optional, RFC 5322
    "url": "https://github.com/anish-k", // optional, https only
  },

  "license": "MIT", // SPDX identifier
  "keywords": ["pdf", "parsing", "data-extraction"], // 1–10, tag-slug shaped

  "runtime": {
    "language": "typescript", // typescript | javascript | python
    "minVersion": "20.0.0", // minimum runtime version
    "dependencies": {
      // declarative only; the portal installs nothing
      "pdf-parse": "^1.1.1",
    },
  },

  "entrypoint": "src/index.ts", // must exist in the archive
  "homepage": "https://…", // optional, https
  "repository": "https://github.com/…", // optional, https

  // exactly one type-specific block, keyed by `type` — see §4
  "skill": {/* … */},
}
```

### 3.1 Field rules

| Field                     | Required | Constraint                                           | Rejection reason if violated                                                                                              |
| ------------------------- | :------: | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `$schema`                 |    no    | Ignored by the validator; present for editor tooling | —                                                                                                                         |
| `specVersion`             | **yes**  | Literal `"1.0"`                                      | Future-proofing. A v2 manifest must not be silently accepted by a v1 validator.                                           |
| `name`                    | **yes**  | `^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$`               | Becomes the URL slug. No uppercase, no underscores, no leading/trailing hyphen. Same rule npm uses, for the same reasons. |
| `displayName`             | **yes**  | 1–80 chars                                           | The catalog card title                                                                                                    |
| `type`                    | **yes**  | One of four literals                                 | Selects the union branch. Immutable across a component's lifetime.                                                        |
| `version`                 | **yes**  | Strict semver `x.y.z[-pre][+build]`                  | Must sort strictly above the current latest. No `^`, `~`, or `v` prefix.                                                  |
| `description`             | **yes**  | 10–300 chars                                         | Under 10 is not a description; over 300 belongs in the README.                                                            |
| `author.name`             | **yes**  | 1–100 chars                                          | Attribution                                                                                                               |
| `license`                 | **yes**  | SPDX id from an allowlist                            | An unlicensed component is legally unusable. Reject `"UNLICENSED"` in v1.                                                 |
| `keywords`                | **yes**  | 1–10 items, each `^[a-z0-9-]{2,30}$`                 | Drives tag facets. At least one forces the author to categorize.                                                          |
| `runtime.language`        | **yes**  | enum                                                 | Powers a future language filter                                                                                           |
| `entrypoint`              | **yes**  | Relative POSIX path; **must exist in the archive**   | Cross-validated against the archive listing, not just the string                                                          |
| `homepage` / `repository` |    no    | `https://` only                                      | Rejecting `http://` and `javascript:` closes an XSS vector on the detail page                                             |

### 3.2 Cross-field validations

These cannot be expressed by a plain schema and run as a second pass after Zod:

1. `entrypoint` MUST be present in the archive entry list.
2. `name` MUST match the archive filename stem when publishing a **new version**
   (guards against uploading the wrong file to the right component).
3. On a new version, manifest `type` MUST equal the stored type.
4. Every declared `mcp.tools[].name` MUST be unique within the manifest.
5. If `runtime.language === "python"`, `entrypoint` MUST end in `.py`; if
   `typescript`, `.ts`/`.tsx`; if `javascript`, `.js`/`.mjs`.

## 4. Type-specific blocks

Exactly one block is present, and its key MUST equal `type` (with `mcp-gateway` → `mcp`).

### 4.1 `type: "skill"`

A packaged capability an agent loads to perform a task.

```jsonc
"skill": {
  "instructions": "SKILL.md",           // required; path must exist in archive
  "allowedTools": ["read_file", "write_file", "web_search"],  // 0–50
  "triggers": ["extract text from pdf", "parse pdf tables"],  // 1–10 phrases
  "outputs": [
    { "name": "text",   "type": "string", "description": "Extracted plain text" },
    { "name": "tables", "type": "array",  "description": "Detected tables as row arrays" }
  ],
  "examples": [
    { "input": "Extract tables from invoice.pdf", "output": "…" }
  ]
}
```

`triggers` is the highest-value field: it is what a discovery layer matches a user's
intent against, and it makes the skill self-describing.

### 4.2 `type: "plugin"`

An extension bundle hooking into a host application's lifecycle.

```jsonc
"plugin": {
  "host": "claude-code",                // claude-code | vscode | generic
  "hooks": [
    { "event": "PreToolUse",  "matcher": "Write|Edit", "handler": "hooks/format.js" },
    { "event": "PostToolUse", "matcher": "Bash",        "handler": "hooks/audit.js" }
  ],
  "commands": [
    { "name": "lint-all", "description": "Lint the whole workspace", "handler": "commands/lint.js" }
  ],
  "permissions": ["filesystem:read", "filesystem:write", "network:outbound"],
  "configSchema": { "type": "object", "properties": { "strict": { "type": "boolean" } } }
}
```

At least one of `hooks` or `commands` MUST be non-empty — a plugin that does nothing is
not a plugin. Every `handler` path MUST exist in the archive.

### 4.3 `type: "agent"`

A configured autonomous loop.

```jsonc
"agent": {
  "systemPrompt": "prompts/system.md",   // path OR inline string ≤ 8000 chars
  "model": {
    "provider": "anthropic",             // anthropic | openai | google | local
    "preferred": "claude-sonnet-5",
    "fallback": ["claude-haiku-4-5-20251001"],
    "temperature": 0.2,                  // 0–2
    "maxTokens": 8192
  },
  "tools": [
    { "name": "search_docs", "source": "builtin" },
    { "name": "query_db",    "source": "mcp", "gateway": "postgres-gateway" }
  ],
  "maxIterations": 12,                   // 1–100 — a required runaway-loop guard
  "memory": { "type": "conversation", "maxMessages": 50 },  // none|conversation|vector
  "guardrails": {
    "requireHumanApproval": ["delete_record", "send_email"],
    "forbiddenTopics": []
  }
}
```

`maxIterations` and `guardrails` are required-by-design: an agent spec without a stopping
condition and an approval boundary is an incident waiting to happen. Encoding that in the
schema is a strong safety-thinking signal.

### 4.4 `type: "mcp-gateway"`

A Model Context Protocol server exposing tools and resources.

```jsonc
"mcp": {
  "protocolVersion": "2025-06-18",
  "transport": "stdio",                  // stdio | http | sse
  "command": { "run": "node", "args": ["dist/server.js"] },  // required for stdio
  "endpoint": null,                      // required for http/sse instead of `command`
  "auth": {
    "type": "none",                      // none | apiKey | oauth2 | bearer
    "envVars": ["POSTGRES_URL"]          // names only — NEVER values
  },
  "tools": [
    {
      "name": "query",
      "description": "Run a read-only SQL query",
      "inputSchema": {
        "type": "object",
        "properties": { "sql": { "type": "string" } },
        "required": ["sql"]
      },
      "readOnly": true
    }
  ],
  "resources": [
    { "uri": "postgres://schema", "name": "Database schema", "mimeType": "application/json" }
  ],
  "prompts": []
}
```

**Hard rules:**

- `transport: "stdio"` → `command` required, `endpoint` MUST be null.
- `transport: "http" | "sse"` → `endpoint` required and MUST be `https://`.
- `auth.envVars` holds **names only**. A value that looks like a secret is a rejection,
  not a warning — see §7.
- `tools[].name` unique; at least one of `tools` / `resources` / `prompts` non-empty.

## 5. Zod implementation

Target: `src/domain/schemas/manifest.ts`. Written out because getting the discriminated
union right is the crux of the whole feature.

```ts
import { z } from "zod";

// ── shared primitives ────────────────────────────────────────
const slugName = z
  .string()
  .regex(
    /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/,
    "Must be lowercase alphanumeric with hyphens, 1–64 chars, no leading/trailing hyphen",
  );

const semver = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/,
    "Must be valid semver, e.g. 1.0.0",
  );

const httpsUrl = z.url().refine((u) => u.startsWith("https://"), "Must use https://");

const archivePath = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (p) => !p.startsWith("/") && !p.includes("..") && !p.includes("\\"),
    "Must be a relative POSIX path without '..'",
  );

const SPDX = [
  "MIT",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "GPL-3.0-only",
  "AGPL-3.0-only",
  "MPL-2.0",
  "Unlicense",
] as const;

// ── base, shared by every type ───────────────────────────────
const baseManifest = z.object({
  $schema: z.string().optional(),
  specVersion: z.literal("1.0"),
  name: slugName,
  displayName: z.string().min(1).max(80),
  version: semver,
  description: z.string().min(10).max(300),
  author: z
    .object({
      name: z.string().min(1).max(100),
      email: z.email().optional(),
      url: httpsUrl.optional(),
    })
    .strict(),
  license: z.enum(SPDX),
  keywords: z
    .array(z.string().regex(/^[a-z0-9-]{2,30}$/))
    .min(1)
    .max(10),
  runtime: z
    .object({
      language: z.enum(["typescript", "javascript", "python"]),
      minVersion: z.string().optional(),
      dependencies: z.record(z.string(), z.string()).optional(),
    })
    .strict(),
  entrypoint: archivePath,
  homepage: httpsUrl.optional(),
  repository: httpsUrl.optional(),
});

// ── type-specific blocks ─────────────────────────────────────
const skillBlock = z
  .object({
    instructions: archivePath,
    allowedTools: z.array(z.string()).max(50).default([]),
    triggers: z.array(z.string().min(3).max(200)).min(1).max(10),
    outputs: z
      .array(
        z
          .object({
            name: z.string(),
            type: z.enum(["string", "number", "boolean", "object", "array"]),
            description: z.string().max(200),
          })
          .strict(),
      )
      .default([]),
    examples: z
      .array(z.object({ input: z.string(), output: z.string() }).strict())
      .max(5)
      .default([]),
  })
  .strict();

const pluginBlock = z
  .object({
    host: z.enum(["claude-code", "vscode", "generic"]),
    hooks: z
      .array(
        z
          .object({
            event: z.string().min(1),
            matcher: z.string().optional(),
            handler: archivePath,
          })
          .strict(),
      )
      .default([]),
    commands: z
      .array(
        z
          .object({
            name: slugName,
            description: z.string().max(200),
            handler: archivePath,
          })
          .strict(),
      )
      .default([]),
    permissions: z
      .array(
        z.enum([
          "filesystem:read",
          "filesystem:write",
          "network:outbound",
          "process:spawn",
          "env:read",
        ]),
      )
      .default([]),
    configSchema: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .refine((p) => p.hooks.length > 0 || p.commands.length > 0, {
    message: "A plugin must declare at least one hook or command",
    path: ["hooks"],
  });

const agentBlock = z
  .object({
    systemPrompt: z.string().min(1).max(8000), // path or inline
    model: z
      .object({
        provider: z.enum(["anthropic", "openai", "google", "local"]),
        preferred: z.string().min(1),
        fallback: z.array(z.string()).max(3).default([]),
        temperature: z.number().min(0).max(2).default(0.7),
        maxTokens: z.number().int().positive().max(200_000).default(4096),
      })
      .strict(),
    tools: z
      .array(
        z
          .object({
            name: z.string().min(1),
            source: z.enum(["builtin", "mcp", "http"]),
            gateway: slugName.optional(),
          })
          .strict(),
      )
      .max(50)
      .default([]),
    maxIterations: z.number().int().min(1).max(100),
    memory: z
      .object({
        type: z.enum(["none", "conversation", "vector"]),
        maxMessages: z.number().int().positive().max(500).optional(),
      })
      .strict()
      .default({ type: "none" }),
    guardrails: z
      .object({
        requireHumanApproval: z.array(z.string()).default([]),
        forbiddenTopics: z.array(z.string()).default([]),
      })
      .strict()
      .default({ requireHumanApproval: [], forbiddenTopics: [] }),
  })
  .strict();

const mcpBlock = z
  .object({
    protocolVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    transport: z.enum(["stdio", "http", "sse"]),
    command: z
      .object({
        run: z.string().min(1),
        args: z.array(z.string()).default([]),
        env: z.record(z.string(), z.string()).optional(),
      })
      .strict()
      .nullable()
      .default(null),
    endpoint: httpsUrl.nullable().default(null),
    auth: z
      .object({
        type: z.enum(["none", "apiKey", "oauth2", "bearer"]),
        envVars: z
          .array(z.string().regex(/^[A-Z][A-Z0-9_]*$/))
          .max(20)
          .default([]),
      })
      .strict(),
    tools: z
      .array(
        z
          .object({
            name: z.string().min(1).max(64),
            description: z.string().min(1).max(300),
            inputSchema: z.record(z.string(), z.unknown()),
            readOnly: z.boolean().default(false),
          })
          .strict(),
      )
      .max(100)
      .default([]),
    resources: z
      .array(
        z
          .object({
            uri: z.string().min(1),
            name: z.string().min(1),
            mimeType: z.string().optional(),
          })
          .strict(),
      )
      .max(100)
      .default([]),
    prompts: z
      .array(
        z
          .object({
            name: slugName,
            description: z.string().max(300),
          })
          .strict(),
      )
      .max(50)
      .default([]),
  })
  .strict()
  .refine((m) => (m.transport === "stdio" ? m.command !== null : m.endpoint !== null), {
    message: "stdio transport requires `command`; http/sse requires `endpoint`",
    path: ["transport"],
  })
  .refine((m) => new Set(m.tools.map((t) => t.name)).size === m.tools.length, {
    message: "Tool names must be unique",
    path: ["tools"],
  })
  .refine((m) => m.tools.length + m.resources.length + m.prompts.length > 0, {
    message: "Declare at least one tool, resource, or prompt",
    path: ["tools"],
  });

// ── the discriminated union ──────────────────────────────────
export const manifestSchema = z.discriminatedUnion("type", [
  baseManifest.extend({ type: z.literal("skill"), skill: skillBlock }).strict(),
  baseManifest.extend({ type: z.literal("plugin"), plugin: pluginBlock }).strict(),
  baseManifest.extend({ type: z.literal("agent"), agent: agentBlock }).strict(),
  baseManifest.extend({ type: z.literal("mcp-gateway"), mcp: mcpBlock }).strict(),
]);

export type ComponentManifest = z.infer<typeof manifestSchema>;
```

`z.discriminatedUnion` (not `z.union`) is the correct tool: it reads `type` first and
reports errors only for the matching branch. A plain union produces four parallel error
trees and an unusable error message.

### 5.1 Turning `ZodError` into `details[]`

```ts
export function toFieldErrors(err: z.ZodError) {
  return err.issues.map((i) => ({
    path: i.path.length
      ? i.path.reduce<string>(
          (acc, seg) =>
            typeof seg === "number"
              ? `${acc}[${seg}]`
              : acc
                ? `${acc}.${seg}`
                : String(seg),
          "",
        )
      : "(root)",
    message: i.message,
  }));
}
```

`tools[0].name` — not `tools,0,name` — is what lets the wizard highlight the exact field.

## 6. Publishing the JSON Schema

Generate `openapi`-adjacent JSON Schema from the same Zod schemas at build time and serve
it at `GET /api/schemas/component-v1.json`. One schema definition drives three consumers:
runtime validation, TypeScript types, and editor autocomplete. Point `$schema` in every
template at that URL, and an author gets red squiggles in VS Code before they ever upload.

## 7. Secret detection in manifests

Small, targeted, and worth the 20 lines. Applied to manifest string values only — this is
**not** general content scanning (out of scope), it is a schema-adjacent guard on a field
that is _documented_ to hold names, not values.

```ts
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bghp_[A-Za-z0-9]{36}\b/, "GitHub personal access token"],
  [/\bgithub_pat_[A-Za-z0-9_]{60,}\b/, "GitHub fine-grained token"],
  [/\bsk-[A-Za-z0-9]{20,}\b/, "API secret key"],
  [/\bsk-ant-[A-Za-z0-9-]{20,}\b/, "Anthropic API key"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key id"],
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, "Private key"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, "Slack token"],
];
```

A match is a **rejection** (`422 MANIFEST_INVALID`, path pointing at the field), not a
warning. Reporting the _pattern name_ and never echoing the matched value back is the
detail that shows you have thought about not leaking the secret a second time in your own
error message.

## 8. Versioning the spec itself

`specVersion` is the escape hatch. When v2 arrives:

1. Add `manifestSchemaV2` alongside v1. Do not edit v1.
2. Branch on `specVersion` before parsing.
3. Serve both `component-v1.json` and `component-v2.json`.
4. Existing v1 components keep working forever.

**Rule: v1 is frozen once the first external component is published.** Adding an optional
field is a v1.1 minor; changing a constraint or adding a required field is v2. This is the
same compatibility discipline as a public API, applied to a data format — and it is
exactly the reasoning an interviewer is probing for when they ask "how would you evolve
this?"
