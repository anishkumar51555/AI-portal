import type Anthropic from "@anthropic-ai/sdk";

/**
 * The agent's tools.
 *
 * Tool descriptions are the single biggest lever on tool-use quality — the model
 * decides whether to call something almost entirely from its description. Say
 * WHEN to call it, not just what it does.
 */

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "calculator",
    description:
      "Evaluate an arithmetic expression exactly. Call this whenever an answer " +
      "depends on a computed number — totals, rates, unit conversions, percentages " +
      "— rather than doing the arithmetic mentally. Supports + - * / % ( ) and ** " +
      "for exponentiation.",
    input_schema: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: 'The expression to evaluate, e.g. "1200 * 4.5 * 8 / 1000".',
        },
      },
      required: ["expression"],
    },
  },
];

export async function runTool(name: string, input: unknown): Promise<string> {
  switch (name) {
    case "calculator":
      return calculate(input);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/**
 * Arithmetic evaluator.
 *
 * A hand-written shunting-yard parser rather than `eval` or `new Function`.
 * The input is model output that can be steered by whatever the model just
 * read — treating it as untrusted is the whole point. `eval` here would be a
 * remote code execution path dressed up as a calculator.
 */
export function calculate(input: unknown): string {
  const expression =
    typeof input === "object" && input !== null && "expression" in input
      ? String((input as { expression: unknown }).expression)
      : "";

  if (!expression.trim()) throw new Error("`expression` is required.");
  if (expression.length > 500) throw new Error("Expression is too long.");

  const tokens = tokenize(expression);
  const rpn = toReversePolish(tokens);
  const value = evaluateRpn(rpn);

  if (!Number.isFinite(value))
    throw new Error("Expression did not produce a finite number.");
  return String(value);
}

type Token = { type: "number"; value: number } | { type: "op"; value: string };

const PRECEDENCE: Record<string, number> = {
  "+": 1,
  "-": 1,
  "*": 2,
  "/": 2,
  "%": 2,
  "**": 3,
};

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expression.length) {
    const char = expression[i]!;

    if (/\s/.test(char)) {
      i++;
      continue;
    }

    if (/[0-9.]/.test(char)) {
      let number = "";
      while (i < expression.length && /[0-9._]/.test(expression[i]!)) {
        if (expression[i] !== "_") number += expression[i]; // allow 1_000_000
        i++;
      }
      const value = Number(number);
      if (Number.isNaN(value)) throw new Error(`Not a number: "${number}"`);
      tokens.push({ type: "number", value });
      continue;
    }

    if (expression.startsWith("**", i)) {
      tokens.push({ type: "op", value: "**" });
      i += 2;
      continue;
    }

    if ("+-*/%()".includes(char)) {
      tokens.push({ type: "op", value: char });
      i++;
      continue;
    }

    throw new Error(`Unexpected character: "${char}"`);
  }

  return tokens;
}

function toReversePolish(tokens: Token[]): Token[] {
  const output: Token[] = [];
  const operators: string[] = [];

  tokens.forEach((token, index) => {
    if (token.type === "number") {
      output.push(token);
      return;
    }

    if (token.value === "(") {
      operators.push("(");
      return;
    }

    if (token.value === ")") {
      while (operators.length > 0 && operators[operators.length - 1] !== "(") {
        output.push({ type: "op", value: operators.pop()! });
      }
      if (operators.pop() !== "(") throw new Error("Unbalanced parentheses.");
      return;
    }

    // Unary minus: a "-" in operand position negates rather than subtracts.
    const previous = tokens[index - 1];
    const isUnary =
      token.value === "-" &&
      (previous === undefined || (previous.type === "op" && previous.value !== ")"));
    if (isUnary) {
      output.push({ type: "number", value: 0 });
    }

    while (operators.length > 0) {
      const top = operators[operators.length - 1]!;
      if (top === "(") break;
      // ** is right-associative; everything else is left-associative.
      const higher =
        token.value === "**"
          ? PRECEDENCE[top]! > PRECEDENCE[token.value]!
          : PRECEDENCE[top]! >= PRECEDENCE[token.value]!;
      if (!higher) break;
      output.push({ type: "op", value: operators.pop()! });
    }
    operators.push(token.value);
  });

  while (operators.length > 0) {
    const op = operators.pop()!;
    if (op === "(") throw new Error("Unbalanced parentheses.");
    output.push({ type: "op", value: op });
  }

  return output;
}

function evaluateRpn(rpn: Token[]): number {
  const stack: number[] = [];

  for (const token of rpn) {
    if (token.type === "number") {
      stack.push(token.value);
      continue;
    }

    const right = stack.pop();
    const left = stack.pop();
    if (left === undefined || right === undefined) throw new Error("Malformed expression.");

    switch (token.value) {
      case "+":
        stack.push(left + right);
        break;
      case "-":
        stack.push(left - right);
        break;
      case "*":
        stack.push(left * right);
        break;
      case "/":
        if (right === 0) throw new Error("Division by zero.");
        stack.push(left / right);
        break;
      case "%":
        if (right === 0) throw new Error("Modulo by zero.");
        stack.push(left % right);
        break;
      case "**":
        stack.push(left ** right);
        break;
      default:
        throw new Error(`Unknown operator: ${token.value}`);
    }
  }

  if (stack.length !== 1) throw new Error("Malformed expression.");
  return stack[0]!;
}
