import { describe, it, expect } from "vitest";
import { execute } from "../src/index.js";

const PASSAGE = [
  "The parser was rewritten to stream input.",
  "Streaming the parser cuts peak memory on large files by about eighty percent.",
  "The weather in Oslo was pleasant that week.",
  "The deprecated parseSync API has been removed from the parser.",
].join(" ");

describe("summarise skill", () => {
  it("returns the requested number of sentences", () => {
    const { summary } = execute({ text: PASSAGE, maxSentences: 2 });
    expect(summary.split(/(?<=[.!?])\s+/)).toHaveLength(2);
  });

  it("keeps sentences in their ORIGINAL order", () => {
    // Ordering by score instead would produce a summary that reads as nonsense.
    const { summary } = execute({ text: PASSAGE, maxSentences: 3 });
    const positions = summary.split(/(?<=[.!?])\s+/).map((s) => PASSAGE.indexOf(s.trim()));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("prefers on-topic sentences over off-topic ones", () => {
    const { summary } = execute({ text: PASSAGE, maxSentences: 2 });
    expect(summary).toMatch(/parser/i);
    expect(summary).not.toMatch(/Oslo/);
  });

  it("returns the input unchanged when it is already short enough", () => {
    const short = "One sentence only.";
    expect(execute({ text: short }).summary).toBe(short);
  });

  it("counts words in the summary, not the source", () => {
    const { summary, wordCount } = execute({ text: PASSAGE, maxSentences: 1 });
    expect(wordCount).toBe(summary.trim().split(/\s+/).length);
  });

  it("rejects empty or non-string input", () => {
    expect(() => execute({ text: "" })).toThrow(/non-empty/);
    expect(() => execute({ text: "   " })).toThrow(/non-empty/);
  });

  it("rejects a nonsensical maxSentences", () => {
    expect(() => execute({ text: PASSAGE, maxSentences: 0 })).toThrow(/positive integer/);
    expect(() => execute({ text: PASSAGE, maxSentences: 1.5 })).toThrow(/positive integer/);
  });
});
