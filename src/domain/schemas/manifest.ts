import { z } from "zod";

/**
 * component.json — specification v1.0.
 *
 * THIS IS THE CORE IP OF THE PROJECT. Everything else — the catalog, the upload
 * wizard, the templates — is an interface to this contract. Strip it out and
 * this is a file host with a search box; keep it and the registry can reject
 * malformed components at the gate, render typed detail pages, and give authors
 * editor autocomplete from a published JSON Schema.
 *
 * Spec: docs/06-component-manifest-spec.md
 * ADR:  docs/adr/ADR-006-manifest-specification.md
 * Features: F2.4 - F2.8
 */

// ─────────────────────── shared primitives ───────────────────────

/** npm-style name. Becomes the URL slug, so no uppercase and no underscores. */
export const slugName = z
  .string()
  .regex(
    /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/,
    "Must be lowercase alphanumeric with hyphens, 1-64 chars, no leading or trailing hyphen",
  );

/** Strict semver. No ranges, no "v" prefix — a version, not a constraint. */
export const semver = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
    "Must be valid semver, e.g. 1.0.0",
  );

/**
 * https only.
 *
 * Rejecting other schemes here is an XSS control, not pedantry: these values
 * are rendered into href attributes on the detail page, and `javascript:` in an
 * href is a working attack. `z.url()` alone accepts it.
 */
// A regex rather than `new URL(...).protocol`: z.url() has already proved the
// string parses, so a try/catch here would be unreachable defensive code — and
// an exception thrown inside a refine escapes as a 500 rather than a 422.
// Case-insensitive because the scheme may be written uppercase before the URL
// parser normalises it.
export const httpsUrl = z
  .url()
  .refine((value) => /^https:\/\//i.test(value), { message: "Must be an https:// URL" });

/** A relative POSIX path inside the archive. Never absolute, never escaping. */
export const archivePath = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (p) => !p.startsWith("/") && !/^[A-Za-z]:/.test(p) && !p.split("/").includes(".."),
    "Must be a relative path inside the archive, with no '..' segments",
  )
  .refine((p) => !p.includes("\\"), "Use forward slashes, even on Windows");

/** An unlicensed component is legally unusable, so the list is closed. */
export const SPDX_LICENSES = [
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

export const keyword = z
  .string()
  .regex(/^[a-z0-9-]{2,30}$/, "Keywords are lowercase, 2-30 chars, hyphens allowed");

// ───────────────────── base, shared by all types ─────────────────────

const baseManifest = z.object({
  // Present so editors can resolve the published schema. Not validated.
  $schema: z.string().optional(),
  specVersion: z.literal("1.0", {
    message: 'Only spec version "1.0" is supported by this registry',
  }),

  name: slugName,
  displayName: z.string().min(1).max(80),
  version: semver,
  description: z
    .string()
    .min(10, "Too short to be useful — describe what this does")
    .max(300, "Over 300 characters belongs in the README, not the manifest"),

  author: z
    .object({
      name: z.string().min(1).max(100),
      email: z.email().optional(),
      url: httpsUrl.optional(),
    })
    .strict(),

  license: z.enum(SPDX_LICENSES),
  keywords: z.array(keyword).min(1, "At least one keyword — it drives discovery").max(10),

  runtime: z
    .object({
      language: z.enum(["typescript", "javascript", "python"]),
      minVersion: z.string().optional(),
      // Declarative only. The portal never installs anything.
      dependencies: z.record(z.string(), z.string()).optional(),
    })
    .strict(),

  entrypoint: archivePath,
  homepage: httpsUrl.optional(),
  repository: httpsUrl.optional(),
});

// ───────────────────────── type blocks ─────────────────────────

const skillBlock = z
  .object({
    instructions: archivePath,
    allowedTools: z.array(z.string().min(1)).max(50).default([]),
    // The highest-value field: what a discovery layer matches user intent against.
    triggers: z
      .array(z.string().min(3).max(200))
      .min(1, "At least one trigger phrase — this is how the skill gets found")
      .max(10),
    outputs: z
      .array(
        z
          .object({
            name: z.string().min(1),
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
    systemPrompt: z.string().min(1).max(8000),
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
    // Required by design. An agent spec with no stopping condition is an
    // incident waiting to happen, so the schema refuses to describe one.
    maxIterations: z
      .number()
      .int()
      .min(1)
      .max(100, "Cap the loop — an unbounded agent is a runaway bill"),
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
    protocolVersion: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "MCP protocol version is a date, e.g. 2025-06-18"),
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
        // NAMES ONLY. A value here is a leaked secret — see assertNoSecrets.
        envVars: z
          .array(
            z.string().regex(/^[A-Z][A-Z0-9_]*$/, "Environment variable NAME, not value"),
          )
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
      .array(z.object({ name: slugName, description: z.string().max(300) }).strict())
      .max(50)
      .default([]),
  })
  .strict()
  .refine((m) => (m.transport === "stdio" ? m.command !== null : m.endpoint !== null), {
    message: "stdio transport requires `command`; http and sse require `endpoint`",
    path: ["transport"],
  })
  .refine((m) => (m.transport === "stdio" ? m.endpoint === null : m.command === null), {
    message: "Set exactly one of `command` (stdio) or `endpoint` (http/sse), not both",
    path: ["transport"],
  })
  .refine((m) => new Set(m.tools.map((t) => t.name)).size === m.tools.length, {
    message: "Tool names must be unique within a gateway",
    path: ["tools"],
  })
  .refine((m) => m.tools.length + m.resources.length + m.prompts.length > 0, {
    message: "Declare at least one tool, resource, or prompt",
    path: ["tools"],
  });

// ─────────────────── the discriminated union ───────────────────

/**
 * `discriminatedUnion`, not `union`.
 *
 * A plain union tries every branch and reports four parallel error trees, which
 * is unreadable. This reads `type` first and reports errors only for the branch
 * that matched. Since the entire value of this schema is the QUALITY of its
 * error messages, that difference is the feature.
 *
 * `.strict()` everywhere: a typo like "decsription" is a loud error at publish
 * time rather than a silently missing field discovered weeks later by a
 * consumer. Unforgiving is correct for a registry.
 */
export const manifestSchema = z.discriminatedUnion("type", [
  baseManifest.extend({ type: z.literal("skill"), skill: skillBlock }).strict(),
  baseManifest.extend({ type: z.literal("plugin"), plugin: pluginBlock }).strict(),
  baseManifest.extend({ type: z.literal("agent"), agent: agentBlock }).strict(),
  baseManifest.extend({ type: z.literal("mcp-gateway"), mcp: mcpBlock }).strict(),
]);

export type ComponentManifest = z.infer<typeof manifestSchema>;
export type ManifestType = ComponentManifest["type"];

/** URL/manifest form (kebab) ↔ database form (SCREAMING_SNAKE). */
export const URL_TYPES = ["skill", "plugin", "agent", "mcp-gateway"] as const;
export const DB_TYPES = ["SKILL", "PLUGIN", "AGENT", "MCP_GATEWAY"] as const;

const TO_DB: Record<ManifestType, (typeof DB_TYPES)[number]> = {
  skill: "SKILL",
  plugin: "PLUGIN",
  agent: "AGENT",
  "mcp-gateway": "MCP_GATEWAY",
};
const TO_URL: Record<(typeof DB_TYPES)[number], ManifestType> = {
  SKILL: "skill",
  PLUGIN: "plugin",
  AGENT: "agent",
  MCP_GATEWAY: "mcp-gateway",
};

/** Convert at the edge — never leak one form into the other's layer. */
export function toDbType(type: ManifestType) {
  return TO_DB[type];
}
export function toUrlType(type: (typeof DB_TYPES)[number]) {
  return TO_URL[type];
}
