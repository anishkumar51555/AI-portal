import ReactMarkdown from "react-markdown";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";

/**
 * Render user-supplied markdown. THE XSS CONTROL POINT.
 *
 * Every README in this application renders through this one component, so
 * there is exactly one place to audit and exactly one place to get wrong
 * (docs/03 §3.5). `dangerouslySetInnerHTML` is banned outright (rules/50).
 *
 * Two independent defences, deliberately:
 *
 *  1. **`rehype-raw` is NOT used.** Without it react-markdown DISCARDS embedded
 *     HTML nodes, so `<img src=x onerror=alert(1)>` produces no output at all.
 *     This alone stops the classic payload.
 *
 *     Verified behaviour, worth knowing before someone files it as a bug: the
 *     tags are dropped and their text kept — `<b>bold</b>` renders as `bold`,
 *     and a bare `<br>` simply disappears. Ordinary text is still escaped
 *     properly (`a & b < c` survives intact), so nothing is corrupted; authors
 *     just cannot use HTML, which is what the spec intends.
 *  2. **`rehype-sanitize` runs anyway.** Defence in depth: it strips event
 *     handlers and non-http(s) URL schemes, so a `[click](javascript:alert(1))`
 *     markdown LINK — which needs no raw HTML at all — is neutralised too. That
 *     second case is the one people forget when they reason "we don't allow
 *     HTML, so we're fine".
 *
 * Features: F4.8
 */

/**
 * GitHub's schema, minus anything that can reach out of the page.
 *
 * The default already forbids `script`, `style` and event handlers. These
 * additions close the remaining ways a README could pull in third-party content
 * or frame something.
 */
const schema = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter(
    (tag) =>
      !["iframe", "object", "embed", "script", "style", "form", "input"].includes(tag),
  ),
  attributes: {
    ...defaultSchema.attributes,
    // Allowlisted per element, so nothing inherits a stray `on*` handler.
    a: [["href"], ["title"]],
    img: [["src"], ["alt"], ["title"]],
    code: [["className"]],
  },
  protocols: {
    ...defaultSchema.protocols,
    // `javascript:` and `data:` are absent by construction — this is an
    // allowlist, not a denylist, so a new scheme is refused by default.
    href: ["http", "https", "mailto"],
    src: ["http", "https"],
  },
};

export function Markdown({ children }: { children: string }) {
  return (
    <div
      className="prose prose-sm dark:prose-invert [&_code]:bg-muted max-w-none [&_code]:rounded [&_code]:px-1 [&_pre]:overflow-x-auto"
      // The rendered markdown may contain wide code blocks or tables; letting
      // them scroll inside the container keeps the PAGE from scrolling
      // sideways on a phone (rules/60).
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, schema]]}
        components={{
          // A README is untrusted third-party content, so every link leaves in
          // a new tab WITHOUT handing the target a window.opener reference.
          a: ({ href, children: text }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">
              {text}
            </a>
          ),
          // Tables are the usual source of horizontal overflow.
          table: ({ children: rows }) => (
            <div className="overflow-x-auto">
              <table>{rows}</table>
            </div>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
