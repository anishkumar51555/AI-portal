import { describe, it, expect } from "vitest";
import { calculate } from "../src/tools.js";

/**
 * The calculator is tested directly; the agent loop is not.
 *
 * Testing the loop would mean asserting against a mocked Anthropic client —
 * which tests the mock, not the agent. What IS worth pinning is the tool: it
 * evaluates model-supplied strings, so its safety properties are the ones a
 * bug would actually cost you.
 */

describe("calculator", () => {
  it.each([
    ["2 + 2", "4"],
    ["10 / 4", "2.5"],
    ["2 * 3 + 4", "10"],
    ["2 + 3 * 4", "14"], // precedence, not left-to-right
    ["(2 + 3) * 4", "20"],
    ["2 ** 3 ** 2", "512"], // ** is right-associative: 2^(3^2)
    ["10 % 3", "1"],
    ["-5 + 3", "-2"], // unary minus
    ["1_200 * 4.5", "5400"], // underscores allowed in numerals
  ])("evaluates %s to %s", (expression, expected) => {
    expect(calculate({ expression })).toBe(expected);
  });

  it("computes the worked example from the system prompt", () => {
    expect(calculate({ expression: "1200 * 4.5 * 8 / 1000" })).toBe("43.2");
  });

  it("does NOT evaluate arbitrary code", () => {
    // The input is model output, which can be steered by whatever the model
    // just read. A calculator built on eval() is a remote code execution path
    // wearing a disguise — these must all be parse errors, not results.
    for (const attack of [
      "process.exit(1)",
      "require('fs').readFileSync('/etc/passwd')",
      "globalThis.fetch('https://evil.example')",
      "1; console.log('pwned')",
      "__proto__",
    ]) {
      expect(() => calculate({ expression: attack })).toThrow();
    }
  });

  it("rejects malformed expressions rather than guessing", () => {
    expect(() => calculate({ expression: "2 +" })).toThrow(/Malformed/);
    expect(() => calculate({ expression: "(2 + 3" })).toThrow(/parentheses/);
    expect(() => calculate({ expression: "2 + 3)" })).toThrow(/parentheses/);
  });

  it("reports division and modulo by zero instead of returning Infinity", () => {
    expect(() => calculate({ expression: "1 / 0" })).toThrow(/zero/);
    expect(() => calculate({ expression: "1 % 0" })).toThrow(/zero/);
  });

  it("requires a non-empty expression", () => {
    expect(() => calculate({})).toThrow(/required/);
    expect(() => calculate({ expression: "   " })).toThrow(/required/);
  });

  it("caps input length", () => {
    expect(() => calculate({ expression: "1+".repeat(400) })).toThrow(/too long/);
  });
});
