# My Agent

> **This file becomes your component's page in the catalog.** Rewrite it for
> someone deciding whether to run your agent.

A starter Agent for the AI Component Ecosystem Portal. It implements a real
agent loop against the Anthropic Messages API — tool definitions, the
`tool_use` → `tool_result` round trip, and a hard iteration cap.

## Quick start

```bash
npm install
npm test                       # 8 passing tests, no API key needed
cp .env.example .env           # add your ANTHROPIC_API_KEY
npm run build
node dist/index.js "A server handles 1200 req/s at 4.5 KB each. Egress in Mbps?"
```

## The loop

This is the part worth reading — everything else is replaceable:

```
request  →  inspect stop_reason
              ├─ "end_turn"   → done, return the text
              ├─ "tool_use"   → run every requested tool, send ALL results
              │                 back in ONE user message, loop
              ├─ "pause_turn" → re-send to resume (do NOT add "continue")
              ├─ "refusal"    → declined by safety systems; content may be empty
              └─ "max_tokens" → truncated; return what there is
```

Three details in `src/index.ts` are easy to get wrong and expensive to debug:

| Detail                                              | Why                                                                                                            |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Append `response.content` verbatim                  | Rebuilding the assistant turn from its text drops `thinking` and `tool_use` blocks and breaks the next request |
| All tool results in **one** user message            | Splitting them teaches the model to stop requesting tools in parallel                                          |
| Check `stop_reason` **before** reading `content[0]` | A refusal returns HTTP 200 with empty or partial content                                                       |

## Configuration

`component.json` declares the agent; `DEFAULT_CONFIG` in `src/index.ts` mirrors
it. Keep them in sync.

**`maxIterations` is required by the manifest spec, deliberately.** An agent
loop with no stopping condition is an incident waiting to happen — a tool that
always errors will loop until someone notices the bill.

> **No `temperature`.** Current Claude models reject it with an HTTP 400. Use
> `effort` (`low` … `max`) instead — it tunes how hard the model thinks rather
> than how randomly it samples. The manifest schema enforces this: a manifest
> with `provider: "anthropic"` and a `temperature` is rejected at publish time,
> with a message pointing you at `effort`.

## The calculator tool

`src/tools.ts` ships one working tool, and it is deliberately **not** built on
`eval`. Tool input is model output, and model output can be steered by whatever
the model just read — a calculator using `eval` is a remote code execution path
in a disguise. It is a hand-written shunting-yard parser instead, with tests
asserting that `require('fs')…` and friends are parse errors.

Note the tool _description_: it says **when** to call the tool, not just what it
does. That phrasing is the single biggest lever on whether the model uses it.

## Making it yours

1. Rewrite `prompts/system.md` — this is where most of the behaviour lives.
2. Replace the calculator in `src/tools.ts` with your own tools.
3. Update `component.json`: model, `maxIterations`, `guardrails`, `tools`.
4. `npm run pack`, then upload at `/publish`.

Full walkthrough in [`docs/GETTING-STARTED.md`](docs/GETTING-STARTED.md).

## Licence

MIT.
