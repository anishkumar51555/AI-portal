/**
 * PreToolUse hook: block writes that would commit a credential.
 *
 * A hook is a small program. It reads one JSON object on stdin, decides, and
 * signals its decision through the EXIT CODE:
 *
 *   exit 0  — allow
 *   exit 2  — block; whatever you print on stderr is shown as the reason
 *
 * Anything else is treated as the hook itself being broken, and the operation
 * is allowed through. That default matters: a buggy hook must not brick the
 * user's editor.
 */

export interface PreToolUsePayload {
  tool_name: string;
  tool_input: {
    file_path?: string;
    content?: string;
  };
}

/** Credential shapes worth stopping before they reach a file. */
const SECRET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bghp_[A-Za-z0-9]{36}\b/, "GitHub personal access token"],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}\b/, "Anthropic API key"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key id"],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, "Private key"],
  [/\bpostgres(?:ql)?:\/\/[^:\s]+:[^@\s]+@/, "Database URL with an inline password"],
];

export interface Decision {
  allow: boolean;
  reason?: string;
}

/**
 * Pure decision function, so it is testable without spawning a process.
 *
 * The reason names the PATTERN, never the matched text — echoing the secret
 * back would write it into the transcript, which is where it least belongs.
 */
export function decide(payload: PreToolUsePayload): Decision {
  const content = payload.tool_input?.content;
  if (typeof content !== "string" || content.length === 0) return { allow: true };

  for (const [pattern, label] of SECRET_PATTERNS) {
    if (pattern.test(content)) {
      const where = payload.tool_input.file_path ?? "this file";
      return {
        allow: false,
        reason:
          `Blocked: this write to ${where} contains what looks like a ${label}.\n` +
          `Move it to an environment variable and reference it by name.`,
      };
    }
  }

  return { allow: true };
}

/** Entrypoint when the host runs this file as a process. */
async function main(): Promise<void> {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;

  let payload: PreToolUsePayload;
  try {
    payload = JSON.parse(raw) as PreToolUsePayload;
  } catch {
    // Unparseable input means the hook is broken, not that the write is bad.
    // Fail OPEN — a broken hook must never block the user's work.
    process.exit(0);
  }

  const decision = decide(payload);
  if (decision.allow) process.exit(0);

  process.stderr.write(`${decision.reason}\n`);
  process.exit(2);
}

// Only run when executed directly, so tests can import `decide` freely.
if (
  process.argv[1]?.endsWith("guard-secrets.ts") ||
  process.argv[1]?.endsWith("guard-secrets.js")
) {
  void main();
}
