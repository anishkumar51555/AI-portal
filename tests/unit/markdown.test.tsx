import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { Markdown } from "@/components/features/catalog/markdown";

/**
 * README sanitization — the XSS control point.
 *
 * Rendered with `renderToStaticMarkup` so the assertions are about the HTML a
 * browser would actually receive, not about which plugins were configured. A
 * test that checked the plugin list would pass even if the plugin did nothing.
 *
 * Spec: docs/08-security-model.md §4 row 9 · rules/50
 * Features: F4.8
 */

const render = (markdown: string) => renderToStaticMarkup(<Markdown>{markdown}</Markdown>);

describe("[F4.8] raw HTML in a README", () => {
  it("renders an onerror payload inert", () => {
    const html = render('<img src=x onerror="alert(1)">');

    // The canonical stored-XSS payload. It must not become a real <img>, and
    // the handler must not survive in any form.
    expect(html).not.toContain("onerror");
    expect(html).not.toMatch(/<img[^>]*src=["']?x/);
  });

  it("does not execute a script tag", () => {
    const html = render("<script>alert(document.cookie)</script>");

    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(document.cookie)</script>");
  });

  it("strips an iframe", () => {
    expect(render('<iframe src="https://evil.example"></iframe>')).not.toContain("<iframe");
  });

  it("neutralises an svg onload", () => {
    expect(render("<svg onload=alert(1)>")).not.toContain("onload");
  });

  it("drops HTML tags but keeps their text, and still escapes real text", () => {
    // Measured behaviour, not assumed: react-markdown discards HTML nodes
    // rather than escaping them for display. `<b>bold</b>` becomes `bold` and a
    // bare `<br>` vanishes — authors cannot use HTML, which is the intent.
    expect(render("<b>bold</b>")).toContain("<p>bold</p>");
    expect(render("plain <br> break")).not.toContain("<br");

    // Genuine text containing angle brackets is still escaped correctly, so
    // prose is never corrupted on its way through.
    expect(render("a & b < c")).toContain("a &amp; b &lt; c");
  });
});

describe("[F4.8] dangerous URLs in ordinary markdown", () => {
  it("strips a javascript: link, which needs no raw HTML at all", () => {
    // The case people miss when they reason "we don't allow HTML, so we're
    // safe" — this is pure markdown link syntax.
    const html = render("[click me](javascript:alert(1))");

    expect(html).not.toContain("javascript:");
    expect(html).toContain("click me");
  });

  it("strips a data: URI image", () => {
    const html = render("![x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)");
    expect(html).not.toContain("data:text/html");
  });

  it("strips vbscript: too, because the allowlist is positive", () => {
    expect(render("[x](vbscript:msgbox(1))")).not.toContain("vbscript:");
  });
});

describe("legitimate markdown still works", () => {
  it("renders headings, emphasis, and code", () => {
    const html = render("# Title\n\nSome **bold** and `inline code`.");

    expect(html).toContain("<h1");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code");
  });

  it("renders GFM tables inside a horizontally scrollable wrapper", () => {
    const html = render("| a | b |\n| - | - |\n| 1 | 2 |");

    // GFM must be on, and the wrapper is what stops a wide table scrolling the
    // whole PAGE sideways on a phone (rules/60).
    expect(html).toContain("<table>");
    expect(html).toContain("overflow-x-auto");
  });

  it("keeps https links and makes them safe to open", () => {
    const html = render("[docs](https://example.com/guide)");

    expect(html).toContain('href="https://example.com/guide"');
    // Without noopener the target page gets a handle on window.opener.
    expect(html).toContain("noopener");
    expect(html).toContain("noreferrer");
  });

  it("renders fenced code blocks", () => {
    const html = render("```ts\nconst x = 1;\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain("const x = 1;");
  });

  it("renders an https image", () => {
    expect(render("![alt](https://example.com/a.png)")).toContain(
      'src="https://example.com/a.png"',
    );
  });
});
