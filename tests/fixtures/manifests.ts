import type { ComponentManifest } from "@/domain/schemas/manifest";

/**
 * Narrowed per-type aliases.
 *
 * Typing a fixture as the whole union would make `validGateway.mcp` inaccessible
 * without a narrowing check in every test — which is noise that hides intent.
 * Extracting the branch keeps the fixtures type-safe AND directly usable.
 */
type SkillManifest = Extract<ComponentManifest, { type: "skill" }>;
type PluginManifest = Extract<ComponentManifest, { type: "plugin" }>;
type AgentManifest = Extract<ComponentManifest, { type: "agent" }>;
type GatewayManifest = Extract<ComponentManifest, { type: "mcp-gateway" }>;

/**
 * Canonical valid manifests, one per type.
 *
 * Deliberately typed as `ComponentManifest`: if the schema changes in a way
 * these no longer satisfy, the TYPE CHECK fails before any test runs. A plain
 * object literal would let the fixtures rot silently.
 */

export const validSkill: SkillManifest = {
  specVersion: "1.0",
  name: "pdf-extractor",
  displayName: "PDF Extractor",
  type: "skill",
  version: "1.0.0",
  description: "Extracts structured text and tables from PDF documents.",
  author: { name: "Test Author" },
  license: "MIT",
  keywords: ["pdf", "parsing"],
  runtime: { language: "typescript", minVersion: "20.0.0" },
  entrypoint: "src/index.ts",
  skill: {
    instructions: "SKILL.md",
    allowedTools: ["read_file"],
    triggers: ["extract text from a pdf"],
    outputs: [{ name: "text", type: "string", description: "Extracted plain text" }],
    examples: [],
  },
};

export const validPlugin: PluginManifest = {
  specVersion: "1.0",
  name: "format-on-write",
  displayName: "Format On Write",
  type: "plugin",
  version: "1.0.0",
  description: "Formats files automatically after they are written.",
  author: { name: "Test Author" },
  license: "MIT",
  keywords: ["formatting", "hooks"],
  runtime: { language: "typescript" },
  entrypoint: "src/index.ts",
  plugin: {
    host: "claude-code",
    hooks: [{ event: "PostToolUse", matcher: "Write|Edit", handler: "src/hooks/format.ts" }],
    commands: [],
    permissions: ["filesystem:read", "filesystem:write"],
  },
};

export const validAgent: AgentManifest = {
  specVersion: "1.0",
  name: "research-agent",
  displayName: "Research Agent",
  type: "agent",
  version: "1.0.0",
  description: "Researches a topic and returns a cited summary.",
  author: { name: "Test Author" },
  license: "Apache-2.0",
  keywords: ["research", "summarization"],
  runtime: { language: "typescript" },
  entrypoint: "src/index.ts",
  agent: {
    systemPrompt: "prompts/system.md",
    model: {
      provider: "anthropic",
      preferred: "claude-opus-5",
      fallback: ["claude-haiku-4-5"],
      effort: "high",
      maxTokens: 8192,
    },
    tools: [{ name: "web_search", source: "builtin" }],
    maxIterations: 10,
    memory: { type: "conversation", maxMessages: 40 },
    guardrails: { requireHumanApproval: [], forbiddenTopics: [] },
  },
};

export const validGateway: GatewayManifest = {
  specVersion: "1.0",
  name: "postgres-gateway",
  displayName: "Postgres Gateway",
  type: "mcp-gateway",
  version: "1.0.0",
  description: "Exposes a read-only PostgreSQL database to MCP clients.",
  author: { name: "Test Author" },
  license: "MIT",
  keywords: ["database", "postgres"],
  runtime: { language: "typescript" },
  entrypoint: "src/server.ts",
  mcp: {
    protocolVersion: "2025-06-18",
    transport: "stdio",
    command: { run: "node", args: ["dist/server.js"] },
    endpoint: null,
    auth: { type: "none", envVars: ["POSTGRES_URL"] },
    tools: [
      {
        name: "query",
        description: "Run a read-only SQL query",
        inputSchema: { type: "object", properties: { sql: { type: "string" } } },
        readOnly: true,
      },
    ],
    resources: [],
    prompts: [],
  },
};

export const VALID_BY_TYPE = {
  skill: validSkill,
  plugin: validPlugin,
  agent: validAgent,
  "mcp-gateway": validGateway,
} as const;

/** A mutable deep copy, so a test can break one field without affecting others. */
export function clone<T>(value: T): T {
  return structuredClone(value);
}
