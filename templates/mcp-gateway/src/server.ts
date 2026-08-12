import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { NoteStore } from "./store.js";

/**
 * An MCP server over stdio.
 *
 * MCP is how a client (Claude Desktop, an IDE, an agent) discovers and calls
 * capabilities you expose. This file is the whole integration; `store.ts` is the
 * domain. Replace the store, keep this shape.
 *
 * THE STDIO RULE: on a stdio transport, stdout is the protocol channel. Anything
 * you print there corrupts the JSON-RPC stream and the client disconnects with
 * a parse error that points nowhere useful. Log to stderr — always.
 */

export const store = new NoteStore([
  { title: "Portal spec", body: "component.json must sit at the archive root." },
  { title: "Standup", body: "Ship the gateway template; review the publish pipeline." },
]);

export function createServer(notes: NoteStore = store): McpServer {
  const server = new McpServer({
    name: "my-mcp-gateway",
    version: "1.0.0",
  });

  /**
   * A read-only tool.
   *
   * The description is the model's only basis for deciding whether to call
   * this, so it says WHEN to use it, not just what it does. Schemas are Zod —
   * the SDK converts them to the JSON Schema that goes on the wire.
   */
  server.registerTool(
    "search_notes",
    {
      title: "Search notes",
      description:
        "Search the note collection by keyword and return matching notes with " +
        "their titles and bodies. Call this when the user asks what is in their " +
        "notes, or asks a question the notes might answer.",
      inputSchema: {
        query: z.string().min(1).describe("Keyword or phrase to search for"),
        limit: z.number().int().min(1).max(50).optional().describe("Max notes (default 5)"),
      },
    },
    async ({ query, limit }) => {
      const results = notes.search(query, limit ?? 5);

      if (results.length === 0) {
        // A plain "nothing found" beats an error: the model can act on it.
        return { content: [{ type: "text", text: `No notes match "${query}".` }] };
      }

      const rendered = results.map((note) => `## ${note.title}\n${note.body}`).join("\n\n");

      return {
        content: [
          {
            type: "text",
            text: `${results.length} note(s) matching "${query}":\n\n${rendered}`,
          },
        ],
      };
    },
  );

  /** A write tool. `readOnly: false` in component.json marks it as mutating. */
  server.registerTool(
    "add_note",
    {
      title: "Add note",
      description:
        "Store a new note. Call this when the user asks to remember, save, or " +
        "jot something down.",
      inputSchema: {
        title: z.string().min(1).max(200).describe("Short title for the note"),
        body: z.string().min(1).max(10_000).describe("The note contents"),
      },
    },
    async ({ title, body }) => {
      try {
        const note = notes.add(title, body);
        return {
          content: [{ type: "text", text: `Saved note ${note.id}: "${note.title}".` }],
        };
      } catch (err) {
        // Report the failure as a tool error rather than throwing — the model
        // can then correct itself instead of the whole turn failing.
        return {
          isError: true,
          content: [{ type: "text", text: err instanceof Error ? err.message : "Failed." }],
        };
      }
    },
  );

  /**
   * A resource — data the client can read without a tool call.
   *
   * Tools are verbs, resources are nouns. Use a resource when the client wants
   * to pull context; a tool when it wants something done.
   */
  server.registerResource(
    "all-notes",
    "notes://all",
    {
      title: "All notes",
      description: "Every stored note as JSON.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(notes.all(), null, 2),
        },
      ],
    }),
  );

  return server;
}

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stderr, never stdout — see THE STDIO RULE above.
  console.error(`[my-mcp-gateway] ready on stdio (${store.size} notes)`);
}

// Only start when run directly, so tests can import createServer freely.
if (process.argv[1]?.includes("server")) {
  main().catch((err: unknown) => {
    console.error("[my-mcp-gateway] fatal:", err);
    process.exit(1);
  });
}
