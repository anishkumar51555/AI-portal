/**
 * Plugin entrypoint.
 *
 * The host reads `component.json` to learn which hooks and commands exist and
 * where their handlers live, so this file does not register anything itself.
 * It exists to export the plugin's public surface — useful for testing, for
 * embedding the plugin in another project, and as the one place a reader can
 * see everything the plugin does.
 */

export { decide, type Decision, type PreToolUsePayload } from "./hooks/guard-secrets.js";
export { findTodos, format, type TodoHit } from "./commands/count-todos.js";

export const plugin = {
  name: "my-plugin",
  hooks: ["PreToolUse"],
  commands: ["count-todos"],
} as const;
