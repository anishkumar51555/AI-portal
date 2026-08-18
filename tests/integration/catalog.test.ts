import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { testDb, databaseAvailable, resetDatabase, closeTestDb } from "./_helpers";
import type { DbComponentType } from "@/domain/schemas/manifest";

/**
 * Catalog search — raw SQL, real Postgres.
 *
 * Hand-written SQL is exactly the code a mocked database cannot test: the
 * things that break are the tsquery, the facet WHERE clauses, and the ordering,
 * none of which exist outside the engine.
 *
 * Spec: docs/03-api-contract.md §3.4 · docs/02 §4
 * Features: F4.1–F4.7
 */

const mockAuth = vi.fn();
vi.mock("@/server/auth/config", () => ({ auth: () => mockAuth() }));

let available = false;
let ownerId = "";

beforeAll(async () => {
  available = await databaseAvailable();
}, 60_000);

afterAll(async () => {
  await closeTestDb();
});

interface SeedOptions {
  slug: string;
  displayName?: string;
  type?: DbComponentType;
  summary?: string;
  readme?: string;
  tags?: string[];
  downloads?: number;
  status?: "PUBLISHED" | "DEPRECATED" | "SUSPENDED";
  deleted?: boolean;
}

async function seed(options: SeedOptions) {
  const component = await testDb.component.create({
    data: {
      slug: options.slug,
      name: options.slug,
      displayName: options.displayName ?? options.slug,
      type: options.type ?? "SKILL",
      summary: options.summary ?? "A component that does something useful.",
      readme: options.readme ?? null,
      license: "MIT",
      ownerId,
      downloadCount: options.downloads ?? 0,
      status: options.status ?? "PUBLISHED",
      deletedAt: options.deleted ? new Date() : null,
    },
  });

  const version = await testDb.componentVersion.create({
    data: {
      componentId: component.id,
      version: "1.0.0",
      manifest: {},
      objectKey: `components/${options.slug}/1.0.0/x.zip`,
      sizeBytes: 100,
      checksumSha256: options.slug.padEnd(64, "0"),
      publishedById: ownerId,
    },
  });
  await testDb.component.update({
    where: { id: component.id },
    data: { latestVersionId: version.id },
  });

  for (const slug of options.tags ?? []) {
    const tag = await testDb.tag.upsert({
      where: { slug },
      update: {},
      create: { slug, label: slug.toUpperCase() },
    });
    await testDb.componentTag.create({
      data: { componentId: component.id, tagId: tag.id },
    });
  }

  return component;
}

beforeEach(async () => {
  mockAuth.mockReset();
  mockAuth.mockResolvedValue(null);
  if (!available) return;

  await resetDatabase();
  const owner = await testDb.user.create({
    data: { email: "o@example.com", githubLogin: "owner", image: "https://x/a.png" },
  });
  ownerId = owner.id;
});

interface CatalogResponse {
  data: Array<{ slug: string; type: string; urlType: string; tags: string[] }>;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  facets: {
    types: Array<{ type: string; count: number }>;
    tags: Array<{ slug: string; count: number }>;
  };
}

async function catalog(query = ""): Promise<CatalogResponse> {
  const { GET } = await import("@/app/api/components/route");
  const res = await GET(new Request(`http://localhost:3000/api/components${query}`), {});
  expect(res.status).toBe(200);
  return (await res.json()) as CatalogResponse;
}

describe("[F4.1] full-text search", () => {
  it("finds a component by a word in its name, and ranks it above a README mention", async (ctx) => {
    if (!available) return ctx.skip();

    await seed({ slug: "pdf-extractor", displayName: "PDF Extractor" });
    await seed({
      slug: "note-taker",
      displayName: "Note Taker",
      readme: "You can also export to PDF if you want.",
    });

    const body = await catalog("?q=pdf");

    // Both match; the weighting (A for name, C for readme) decides the order.
    expect(body.data.map((c) => c.slug)).toEqual(["pdf-extractor", "note-taker"]);
  });

  it("stems, so a search for 'extracting' finds 'Extracts'", async (ctx) => {
    if (!available) return ctx.skip();
    await seed({ slug: "pdf-tool", summary: "Extracts tables from documents." });

    expect((await catalog("?q=extracting")).data).toHaveLength(1);
  });

  it("does not throw on hostile query syntax", async (ctx) => {
    if (!available) return ctx.skip();
    await seed({ slug: "anything" });

    // `to_tsquery` raises a syntax error on these, which would turn the search
    // box into a 500 generator. `websearch_to_tsquery` never does (docs/02 §4).
    for (const q of ["'", "a & | b", "!!!", '")', "a:*"]) {
      const { GET } = await import("@/app/api/components/route");
      const res = await GET(
        new Request(`http://localhost:3000/api/components?q=${encodeURIComponent(q)}`),
        {},
      );
      expect(res.status, `query ${q}`).toBe(200);
    }
  });
});

describe("[F4.6] catalog visibility", () => {
  it("hides soft-deleted components", async (ctx) => {
    if (!available) return ctx.skip();
    await seed({ slug: "visible" });
    await seed({ slug: "gone", deleted: true });

    expect((await catalog()).data.map((c) => c.slug)).toEqual(["visible"]);
  });

  it("[F4.7] hides SUSPENDED components from anonymous visitors", async (ctx) => {
    if (!available) return ctx.skip();
    await seed({ slug: "fine" });
    await seed({ slug: "naughty", status: "SUSPENDED" });

    expect((await catalog()).data.map((c) => c.slug)).toEqual(["fine"]);
  });

  it("[F4.7] shows SUSPENDED components to an ADMIN", async (ctx) => {
    if (!available) return ctx.skip();
    await seed({ slug: "fine" });
    await seed({ slug: "naughty", status: "SUSPENDED" });

    const admin = await testDb.user.create({
      data: { email: "admin@example.com", githubLogin: "admin", role: "ADMIN" },
    });
    mockAuth.mockResolvedValue({
      user: {
        id: admin.id,
        role: "ADMIN",
        name: "A",
        email: "admin@example.com",
        image: null,
        githubLogin: "admin",
      },
    });

    expect((await catalog()).data.map((c) => c.slug).sort()).toEqual(["fine", "naughty"]);
  });

  it("keeps DEPRECATED components visible", async (ctx) => {
    if (!available) return ctx.skip();
    await seed({ slug: "old-but-usable", status: "DEPRECATED" });

    // Deprecated means "flagged", not "hidden" — people still depend on it.
    expect((await catalog()).data).toHaveLength(1);
  });
});

describe("[F4.2] filtering", () => {
  it("filters by type, and accepts the parameter repeatedly", async (ctx) => {
    if (!available) return ctx.skip();
    await seed({ slug: "a-skill", type: "SKILL" });
    await seed({ slug: "an-agent", type: "AGENT" });
    await seed({ slug: "a-gateway", type: "MCP_GATEWAY" });

    expect((await catalog("?type=skill")).data.map((c) => c.slug)).toEqual(["a-skill"]);

    const two = await catalog("?type=skill&type=agent");
    expect(two.data.map((c) => c.slug).sort()).toEqual(["a-skill", "an-agent"]);
  });

  it("converts kebab-case URL types to the database spelling", async (ctx) => {
    if (!available) return ctx.skip();
    await seed({ slug: "a-gateway", type: "MCP_GATEWAY" });

    const body = await catalog("?type=mcp-gateway");
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.type).toBe("MCP_GATEWAY");
    expect(body.data[0]?.urlType).toBe("mcp-gateway");
  });

  it("applies AND semantics to tags, not OR", async (ctx) => {
    if (!available) return ctx.skip();
    await seed({ slug: "both", tags: ["pdf", "ocr"] });
    await seed({ slug: "only-pdf", tags: ["pdf"] });

    // OR semantics would return both rows — a filter that only ever widens is
    // useless for narrowing down a large catalog.
    expect((await catalog("?tags=pdf,ocr")).data.map((c) => c.slug)).toEqual(["both"]);
    expect((await catalog("?tags=pdf")).data.map((c) => c.slug).sort()).toEqual([
      "both",
      "only-pdf",
    ]);
  });
});

describe("[F4.3] sorting", () => {
  it("sorts by downloads", async (ctx) => {
    if (!available) return ctx.skip();
    await seed({ slug: "quiet", downloads: 1 });
    await seed({ slug: "popular", downloads: 900 });

    expect((await catalog("?sort=downloads")).data.map((c) => c.slug)).toEqual([
      "popular",
      "quiet",
    ]);
  });

  it("sorts by name", async (ctx) => {
    if (!available) return ctx.skip();
    await seed({ slug: "zebra", displayName: "Zebra" });
    await seed({ slug: "alpha", displayName: "Alpha" });

    expect((await catalog("?sort=name")).data.map((c) => c.slug)).toEqual([
      "alpha",
      "zebra",
    ]);
  });

  it("falls back to downloads when relevance is asked for without a query", async (ctx) => {
    if (!available) return ctx.skip();
    await seed({ slug: "quiet", downloads: 1 });
    await seed({ slug: "popular", downloads: 900 });

    // There is nothing to rank against, so "relevance" would otherwise be an
    // arbitrary order presented as if it meant something (docs/03 §3.4).
    expect((await catalog("?sort=relevance")).data.map((c) => c.slug)).toEqual([
      "popular",
      "quiet",
    ]);
  });
});

describe("[F4.5] pagination", () => {
  it("reports an accurate total and totalPages", async (ctx) => {
    if (!available) return ctx.skip();
    for (let i = 0; i < 7; i += 1) await seed({ slug: `component-${i}` });

    const body = await catalog("?pageSize=3");
    expect(body.data).toHaveLength(3);
    expect(body.pagination).toMatchObject({
      page: 1,
      pageSize: 3,
      total: 7,
      totalPages: 3,
    });
  });

  it("is STABLE across pages when every row ties on the sort key", async (ctx) => {
    if (!available) return ctx.skip();
    // All 10 have downloadCount 0. Without a deterministic tiebreaker, Postgres
    // may order ties differently per query, so a row can appear on two pages
    // while another never appears at all.
    for (let i = 0; i < 10; i += 1) await seed({ slug: `tied-${i}` });

    const seen: string[] = [];
    for (let page = 1; page <= 5; page += 1) {
      const body = await catalog(`?sort=downloads&pageSize=2&page=${page}`);
      seen.push(...body.data.map((c) => c.slug));
    }

    expect(seen).toHaveLength(10);
    expect(new Set(seen).size).toBe(10);
  });

  it("returns an empty page past the end rather than an error", async (ctx) => {
    if (!available) return ctx.skip();
    await seed({ slug: "only-one" });

    const body = await catalog("?page=99");
    expect(body.data).toEqual([]);
    expect(body.pagination.total).toBe(1);
  });

  it("says totalPages 1 on an empty catalog, not 0", async (ctx) => {
    if (!available) return ctx.skip();

    const body = await catalog();
    expect(body.pagination).toMatchObject({ total: 0, totalPages: 1 });
  });
});

describe("[F4.4] facets", () => {
  it("counts types ignoring the type filter, so the sidebar can widen a search", async (ctx) => {
    if (!available) return ctx.skip();
    await seed({ slug: "s1", type: "SKILL" });
    await seed({ slug: "s2", type: "SKILL" });
    await seed({ slug: "a1", type: "AGENT" });

    const body = await catalog("?type=skill");

    expect(body.data).toHaveLength(2);
    // If the facet honoured its own filter, AGENT would read 0 and nobody could
    // ever click their way back out (docs/03 §3.4).
    const counts = Object.fromEntries(body.facets.types.map((t) => [t.type, t.count]));
    expect(counts).toMatchObject({ SKILL: 2, AGENT: 1 });
  });

  it("counts tags ignoring the tag filter", async (ctx) => {
    if (!available) return ctx.skip();
    await seed({ slug: "one", tags: ["pdf", "ocr"] });
    await seed({ slug: "two", tags: ["pdf"] });
    await seed({ slug: "three", tags: ["slack"] });

    const body = await catalog("?tags=pdf");
    const counts = Object.fromEntries(body.facets.tags.map((t) => [t.slug, t.count]));

    expect(body.data).toHaveLength(2);
    expect(counts).toMatchObject({ pdf: 2, ocr: 1, slack: 1 });
  });

  it("narrows facets by the filters that are NOT being counted", async (ctx) => {
    if (!available) return ctx.skip();
    await seed({ slug: "skill-pdf", type: "SKILL", tags: ["pdf"] });
    await seed({ slug: "agent-pdf", type: "AGENT", tags: ["pdf"] });

    // Counting tags while filtered to SKILL must still respect the type filter,
    // or the count promises results the click cannot deliver.
    const body = await catalog("?type=skill");
    const counts = Object.fromEntries(body.facets.tags.map((t) => [t.slug, t.count]));
    expect(counts).toMatchObject({ pdf: 1 });
  });

  it("excludes hidden components from the counts", async (ctx) => {
    if (!available) return ctx.skip();
    await seed({ slug: "shown", type: "SKILL", tags: ["pdf"] });
    await seed({ slug: "hidden", type: "SKILL", tags: ["pdf"], deleted: true });
    await seed({ slug: "suspended", type: "SKILL", tags: ["pdf"], status: "SUSPENDED" });

    const body = await catalog();
    expect(body.facets.types.find((t) => t.type === "SKILL")?.count).toBe(1);
    expect(body.facets.tags.find((t) => t.slug === "pdf")?.count).toBe(1);
  });
});

describe("query strings degrade instead of failing", () => {
  it("clamps nonsense pagination to sensible values", async (ctx) => {
    if (!available) return ctx.skip();
    await seed({ slug: "one" });

    // A stale bookmark or a crawler, far more often than an attack.
    const body = await catalog("?page=abc&pageSize=99999&sort=sideways");
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.pageSize).toBe(100);
    expect(body.data).toHaveLength(1);
  });

  it("ignores unknown type values instead of returning nothing", async (ctx) => {
    if (!available) return ctx.skip();
    await seed({ slug: "one", type: "SKILL" });

    expect((await catalog("?type=wordpress-plugin")).data).toHaveLength(1);
  });

  it("returns the owner and tags with each row", async (ctx) => {
    if (!available) return ctx.skip();
    await seed({ slug: "one", tags: ["pdf", "ocr"] });

    const body = await catalog();
    expect(body.data[0]?.tags.sort()).toEqual(["ocr", "pdf"]);
    expect(body.data[0]).toMatchObject({ slug: "one" });
  });
});
