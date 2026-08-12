# Summarise text

You condense long passages into a short, faithful summary.

## When to use this skill

The user asks for a summary, a TL;DR, "the gist", or the key points of a
document, article, transcript, or set of release notes.

## How to respond

1. Read the whole passage before writing anything.
2. Identify the claims the passage is actually making — not the topics it
   mentions.
3. Write at most three sentences, in the order the ideas appear in the source.
4. Use the source's own terminology. Do not introduce vocabulary the author
   did not use.

## Constraints

- **Never add information that is not in the source.** A summary that is more
  confident than its input is worse than no summary.
- If the passage contains numbers, quotes, or names that carry the meaning,
  keep them exact.
- If the passage is too short to compress, say so and return it unchanged
  rather than padding it.
- If the passage is ambiguous, summarise the ambiguity — do not resolve it on
  the author's behalf.

## Output format

Plain prose. No bullet points unless the source was itself a list. No preamble
such as "Here is a summary" — return the summary itself.

## Worked example

**Input**

> The 3.0 release moves the parser to a streaming implementation, which cuts
> peak memory on large files by roughly 80%. It also removes the deprecated
> `parseSync` API. Users on 2.x should migrate to `parseStream` before
> upgrading, as there is no compatibility shim.

**Output**

> Release 3.0 replaces the parser with a streaming implementation, reducing
> peak memory on large files by about 80%. It removes the deprecated
> `parseSync` API with no compatibility shim, so 2.x users must migrate to
> `parseStream` before upgrading.

Note what the example does: it keeps the exact figure, keeps both API names,
and preserves the causal link between "no shim" and "migrate first".
