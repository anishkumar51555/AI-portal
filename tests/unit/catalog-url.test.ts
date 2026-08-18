import { describe, it, expect } from "vitest";
import {
  clearFilters,
  hasActiveFilters,
  setParam,
  toQueryString,
  toggleMultiParam,
  toggleTag,
} from "@/lib/catalog-url";

/**
 * Catalog URL state.
 *
 * Pure functions, so the whole of the catalog's state management is testable
 * without a router or a rendered component — which is most of the argument for
 * keeping the state in the URL in the first place (rules/60).
 */

const params = (query: string) => new URLSearchParams(query);

describe("setParam", () => {
  it("sets a value", () => {
    expect(setParam(params(""), "q", "pdf").get("q")).toBe("pdf");
  });

  it("removes the key when the value is empty, rather than leaving ?q=", () => {
    // `?q=` and no `q` mean the same thing to the server, but only one of them
    // makes a shareable URL you would want to paste into Slack.
    expect(setParam(params("q=pdf"), "q", "").has("q")).toBe(false);
    expect(setParam(params("q=pdf"), "q", null).has("q")).toBe(false);
  });

  it("resets the page whenever a filter changes", () => {
    // Narrowing a search while on page 7 would otherwise land on an empty page
    // that looks exactly like "no results".
    expect(setParam(params("page=7"), "q", "pdf").has("page")).toBe(false);
    expect(setParam(params("page=7"), "sort", "newest").has("page")).toBe(false);
  });

  it("does NOT reset the page for a non-filter param", () => {
    expect(setParam(params("page=7"), "pageSize", "50").get("page")).toBe("7");
  });
});

describe("toggleMultiParam", () => {
  it("adds a value", () => {
    expect(toggleMultiParam(params(""), "type", "skill").getAll("type")).toEqual(["skill"]);
  });

  it("accumulates repeated values", () => {
    const next = toggleMultiParam(params("type=skill"), "type", "agent");
    expect(next.getAll("type").sort()).toEqual(["agent", "skill"]);
  });

  it("removes a value that is already present", () => {
    const next = toggleMultiParam(params("type=skill&type=agent"), "type", "skill");
    expect(next.getAll("type")).toEqual(["agent"]);
  });

  it("removes the key entirely when the last value goes", () => {
    expect(toggleMultiParam(params("type=skill"), "type", "skill").has("type")).toBe(false);
  });

  it("preserves unrelated params", () => {
    const next = toggleMultiParam(params("q=pdf&sort=newest"), "type", "skill");
    expect(next.get("q")).toBe("pdf");
    expect(next.get("sort")).toBe("newest");
  });

  it("resets the page", () => {
    expect(toggleMultiParam(params("page=3"), "type", "skill").has("page")).toBe(false);
  });
});

describe("toggleTag", () => {
  it("builds a comma-separated list", () => {
    const one = toggleTag(params(""), "pdf");
    expect(one.get("tags")).toBe("pdf");
    expect(toggleTag(one, "ocr").get("tags")).toBe("pdf,ocr");
  });

  it("removes a tag from the middle without disturbing the others", () => {
    expect(toggleTag(params("tags=pdf,ocr,slack"), "ocr").get("tags")).toBe("pdf,slack");
  });

  it("removes the key when the last tag goes", () => {
    expect(toggleTag(params("tags=pdf"), "pdf").has("tags")).toBe(false);
  });

  it("does not produce a trailing comma or an empty entry", () => {
    const next = toggleTag(params("tags=pdf,ocr"), "pdf");
    expect(next.get("tags")).toBe("ocr");
    expect(next.get("tags")).not.toContain(",,");
    expect(next.get("tags")?.endsWith(",")).toBe(false);
  });
});

describe("clearFilters", () => {
  it("drops q, type and tags", () => {
    const next = clearFilters(params("q=pdf&type=skill&tags=ocr&page=4"));
    expect(next.has("q")).toBe(false);
    expect(next.has("type")).toBe(false);
    expect(next.has("tags")).toBe(false);
    expect(next.has("page")).toBe(false);
  });

  it("KEEPS sort and pageSize, which are display preferences not filters", () => {
    // Someone who chose "newest" and 100-per-page is saying how they want to
    // read the catalog, not which rows to hide.
    const next = clearFilters(params("q=pdf&sort=newest&pageSize=100"));
    expect(next.get("sort")).toBe("newest");
    expect(next.get("pageSize")).toBe("100");
  });
});

describe("hasActiveFilters", () => {
  it.each([
    ["q=pdf", true],
    ["type=skill", true],
    ["tags=ocr", true],
    ["", false],
    ["page=3", false],
    // Sorting is not filtering — offering "Clear filters" here would imply
    // rows are hidden when none are.
    ["sort=newest", false],
    ["pageSize=100", false],
  ])("%s → %s", (query, expected) => {
    expect(hasActiveFilters(params(query))).toBe(expected);
  });
});

describe("toQueryString", () => {
  it("prefixes with ? when there is anything to say", () => {
    expect(toQueryString(params("q=pdf"))).toBe("?q=pdf");
  });

  it("returns an empty string rather than a bare ?", () => {
    // A trailing "?" in the address bar is the kind of detail that makes a URL
    // look broken when someone shares it.
    expect(toQueryString(params(""))).toBe("");
  });
});

describe("the original params object is never mutated", () => {
  it("leaves the input untouched on every operation", () => {
    // These run inside React render paths; mutating a URLSearchParams held in
    // a hook would produce the classic "works on the second click" bug.
    const original = params("q=pdf&type=skill&tags=ocr&page=2");
    const before = original.toString();

    setParam(original, "q", "docx");
    toggleMultiParam(original, "type", "agent");
    toggleTag(original, "pdf");
    clearFilters(original);

    expect(original.toString()).toBe(before);
  });
});
