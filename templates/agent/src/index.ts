import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runTool, TOOLS } from "./tools.js";

/**
 * A real agent loop against the Anthropic Messages API.
 *
 * The shape here is the whole point of the template: request → inspect
 * `stop_reason` → run any requested tools → send the results back → repeat,
 * with a hard iteration cap. Everything else is replaceable.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** Mirrors `agent` in component.json. Keep the two in sync when you edit either. */
export interface AgentConfig {
  model: string;
  fallbackModel?: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens: number;
  maxIterations: number;
  maxMessages: number;
}

export const DEFAULT_CONFIG: AgentConfig = {
  model: "claude-opus-5",
  fallbackModel: "claude-haiku-4-5",
  effort: "high",
  maxTokens: 16_000,
  maxIterations: 8,
  maxMessages: 40,
};

export interface RunResult {
  answer: string;
  iterations: number;
  toolCalls: Array<{ name: string; input: unknown }>;
  stoppedBecause: "end_turn" | "max_iterations" | "refusal" | "max_tokens";
}

/**
 * Trim history to the most recent N messages.
 *
 * Always cuts at a `user` message: a history starting with an `assistant` turn
 * is rejected by the API, and one starting with an orphaned `tool_result` whose
 * `tool_use` was trimmed away is rejected too.
 */
function trimHistory(
  messages: Anthropic.MessageParam[],
  maxMessages: number,
): Anthropic.MessageParam[] {
  if (messages.length <= maxMessages) return messages;

  let start = messages.length - maxMessages;
  while (start < messages.length && messages[start]?.role !== "user") start++;

  const trimmed = messages.slice(start);
  return trimmed.length > 0 ? trimmed : messages.slice(-1);
}

export async function run(
  question: string,
  config: AgentConfig = DEFAULT_CONFIG,
  client = new Anthropic(),
): Promise<RunResult> {
  const systemPrompt = await readFile(join(HERE, "..", "prompts", "system.md"), "utf8");

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];
  const toolCalls: RunResult["toolCalls"] = [];

  for (let iteration = 1; iteration <= config.maxIterations; iteration++) {
    const response = await client.messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      system: systemPrompt,
      messages: trimHistory(messages, config.maxMessages),
      tools: TOOLS,
      // Adaptive thinking + effort replace the old temperature/budget_tokens
      // knobs. Current Claude models reject `temperature` with a 400 — do not
      // reintroduce it here.
      thinking: { type: "adaptive" },
      output_config: { effort: config.effort },
    });

    // Safety classifiers can decline a request. This arrives as a normal
    // HTTP 200 with an empty or partial `content`, so reading content[0]
    // without checking stop_reason first is a crash waiting to happen.
    if (response.stop_reason === "refusal") {
      return {
        answer: "The request was declined by the model's safety systems.",
        iterations: iteration,
        toolCalls,
        stoppedBecause: "refusal",
      };
    }

    if (response.stop_reason === "max_tokens") {
      return {
        answer: textOf(response),
        iterations: iteration,
        toolCalls,
        stoppedBecause: "max_tokens",
      };
    }

    // Preserve the assistant turn verbatim — thinking and tool_use blocks
    // included. Rebuilding it from the text alone breaks the next request.
    messages.push({ role: "assistant", content: response.content });

    // A server-side tool ran out of iterations. Re-send to resume; do NOT add
    // a "continue" message — the API detects the paused turn on its own.
    if (response.stop_reason === "pause_turn") continue;

    if (response.stop_reason !== "tool_use") {
      return {
        answer: textOf(response),
        iterations: iteration,
        toolCalls,
        stoppedBecause: "end_turn",
      };
    }

    const requests = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    // Run them concurrently, then return EVERY result in ONE user message.
    // Splitting results across messages teaches the model to stop asking for
    // tools in parallel.
    const results = await Promise.all(
      requests.map(async (request): Promise<Anthropic.ToolResultBlockParam> => {
        toolCalls.push({ name: request.name, input: request.input });
        try {
          return {
            type: "tool_result",
            tool_use_id: request.id,
            content: await runTool(request.name, request.input),
          };
        } catch (err) {
          // Report the failure rather than dropping the block — an unanswered
          // tool_use makes the next request invalid.
          return {
            type: "tool_result",
            tool_use_id: request.id,
            content: err instanceof Error ? err.message : "Tool failed.",
            is_error: true,
          };
        }
      }),
    );

    messages.push({ role: "user", content: results });
  }

  // The guard `maxIterations` exists for. Without it a tool-loop bug bills
  // until someone notices.
  return {
    answer: "Stopped: reached the maximum number of iterations without finishing.",
    iterations: config.maxIterations,
    toolCalls,
    stoppedBecause: "max_iterations",
  };
}

function textOf(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

// Run directly: npm run build && node dist/index.js "your question"
if (process.argv[1]?.includes("index")) {
  const question = process.argv.slice(2).join(" ");
  if (!question) {
    console.error('Usage: node dist/index.js "your question"');
    process.exit(1);
  }
  const result = await run(question);
  console.log(`\n${result.answer}\n`);
  console.error(
    `[${result.iterations} iteration(s), ${result.toolCalls.length} tool call(s), stopped: ${result.stoppedBecause}]`,
  );
}
