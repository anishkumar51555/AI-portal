import { describe, it, expect } from "vitest";
import { decide } from "../src/hooks/guard-secrets.js";
import { format, type TodoHit } from "../src/commands/count-todos.js";

describe("guard-secrets hook", () => {
  const write = (content: string) => ({
    tool_name: "Write",
    tool_input: { file_path: "src/config.ts", content },
  });

  it("allows an ordinary write", () => {
    expect(decide(write("export const PORT = 3000;")).allow).toBe(true);
  });

  it.each([
    ["ghp_" + "a".repeat(36), "GitHub personal access token"],
    ["AKIA" + "ABCDEFGHIJKLMNOP", "AWS access key id"],
    ["-----BEGIN RSA PRIVATE KEY-----", "Private key"],
    ["postgresql://user:hunter2@host/db", "Database URL with an inline password"],
  ])("blocks a write containing %s", (secret, label) => {
    const decision = decide(write(`const KEY = "${secret}";`));
    expect(decision.allow).toBe(false);
    expect(decision.reason).toContain(label);
  });

  it("never echoes the secret back into the transcript", () => {
    // The reason is shown to the user and recorded. Repeating the credential
    // there would put it in the one place it least belongs.
    const secret = "ghp_" + "b".repeat(36);
    const decision = decide(write(`const KEY = "${secret}";`));
    expect(decision.reason).not.toContain(secret);
  });

  it("names the file so the reason is actionable", () => {
    const decision = decide(write(`const K = "AKIAABCDEFGHIJKLMNOP";`));
    expect(decision.reason).toContain("src/config.ts");
  });

  it("allows a write with no content field at all", () => {
    // Tool calls that are not writes still reach a PreToolUse hook.
    expect(decide({ tool_name: "Bash", tool_input: {} }).allow).toBe(true);
  });
});

describe("count-todos command", () => {
  it("reports nothing found in a readable way", () => {
    expect(format([], "/root")).toBe("No TODO comments found.");
  });

  it("pluralises correctly", () => {
    const one: TodoHit[] = [{ file: "/root/a.ts", line: 3, text: "// TODO: fix" }];
    expect(format(one, "/root")).toContain("1 TODO comment:");

    const two: TodoHit[] = [...one, { file: "/root/b.ts", line: 9, text: "// TODO: also" }];
    expect(format(two, "/root")).toContain("2 TODO comments:");
  });

  it("shows paths relative to the workspace root", () => {
    const hits: TodoHit[] = [{ file: "/root/src/a.ts", line: 3, text: "// TODO: fix" }];
    const output = format(hits, "/root");
    expect(output).toContain("/src/a.ts:3");
    expect(output).not.toContain("/root/src");
  });
});
