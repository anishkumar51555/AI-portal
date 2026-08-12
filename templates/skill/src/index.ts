/**
 * A working extractive summariser.
 *
 * Deliberately real rather than a `throw new Error("not implemented")`: a
 * template that fails on first run teaches you that the portal is unreliable.
 * Replace the body, keep the shape.
 */

export interface SummariseInput {
  /** The text to condense. */
  text: string;
  /** How many sentences to keep. Defaults to 3. */
  maxSentences?: number;
}

export interface SummariseOutput {
  summary: string;
  wordCount: number;
}

/** Words carrying little topical signal, so they should not drive scoring. */
const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "if",
  "then",
  "than",
  "that",
  "this",
  "these",
  "those",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "to",
  "of",
  "in",
  "on",
  "at",
  "by",
  "for",
  "with",
  "as",
  "it",
  "its",
  "from",
]);

function splitSentences(text: string): string[] {
  // Split after ., ! or ? when followed by whitespace. Good enough for prose;
  // swap in a proper segmenter if you need abbreviations handled.
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function tokenise(sentence: string): string[] {
  return sentence
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Score each sentence by how many frequent words it contains, keep the best
 * few, and return them in their ORIGINAL order — a summary whose sentences are
 * reordered by score reads as nonsense.
 */
export function execute(input: SummariseInput): SummariseOutput {
  const maxSentences = input.maxSentences ?? 3;

  if (typeof input.text !== "string" || input.text.trim().length === 0) {
    throw new Error("`text` is required and must be a non-empty string");
  }
  if (!Number.isInteger(maxSentences) || maxSentences < 1) {
    throw new Error("`maxSentences` must be a positive integer");
  }

  const sentences = splitSentences(input.text);
  if (sentences.length <= maxSentences) {
    return { summary: input.text.trim(), wordCount: countWords(input.text) };
  }

  const frequency = new Map<string, number>();
  for (const sentence of sentences) {
    for (const word of tokenise(sentence)) {
      frequency.set(word, (frequency.get(word) ?? 0) + 1);
    }
  }

  const ranked = sentences
    .map((sentence, index) => {
      const words = tokenise(sentence);
      const total = words.reduce((sum, w) => sum + (frequency.get(w) ?? 0), 0);
      // Normalise by length, or long sentences always win on raw total.
      return { index, score: words.length > 0 ? total / words.length : 0 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSentences)
    .sort((a, b) => a.index - b.index);

  const summary = ranked.map((r) => sentences[r.index]).join(" ");
  return { summary, wordCount: countWords(summary) };
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}
