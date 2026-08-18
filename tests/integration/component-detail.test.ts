import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { testDb, databaseAvailable, resetDatabase, closeTestDb } from "./_helpers";

/**
 * GET /api/components/:slug.
 *
 * Spec: docs/03-api-contract.md §3.5 · rules/50
 * Features: F4.7
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

beforeEach(async () => {
  mockAuth.mockReset();
  mockAuth.mockResolvedValue(null);
  if (!available) return;

  await resetDatabase();
  const owner = await testDb.user.create({
    data: { email: "o@example.com", githubLogin: "owner", name: "Owner" },
  });
  ownerId = owner.id;
});

async function seed(
  slug: string,
  overrides: Partial<{
    status: "PUBLISHED" | "SUSPENDED";
    deleted: boolean;
    readme: string;
  }> = {},
) {
  const component = await testDb.component.create({
    data: {
      slug,
      name: slug,
      displayName: "PDF Extractor",
      type: "SKILL",
      summary: "Extracts text from PDFs.",
      readme: overrides.readme ?? "# Hello\n\nSome docs.",
      license: "MIT",
      homepage: "https://example.com",
      ownerId,
      downloadCount: 12,
      status: overrides.status ?? "PUBLISHED",
      deletedAt: overrides.deleted ? new Date() : null,
    },
  });

  const version = await testDb.componentVersion.create({
    data: {
      componentId: component.id,
      version: "1.2.0",
      manifest: { specVersion: "1.0", name: slug },
      objectKey: `components/${slug}/1.2.0/x.zip`,
      sizeBytes: 20_481,
      checksumSha256: slug.padEnd(64, "a"),
      changelog: "Adds table extraction.",
      publishedById: ownerId,
    },
  });
  await testDb.component.update({
    where: { id: component.id },
    data: { latestVersionId: version.id },
  });
}

async function get(slug: string) {
  const { GET } = await import("@/app/api/components/[slug]/route");
  return GET(new Request(`http://localhost:3000/api/components/${slug}`), {
    params: Promise.resolve({ slug }),
  });
}

function asAdmin() {
  return testDb.user
    .create({ data: { email: "a@example.com", githubLogin: "adm", role: "ADMIN" } })
    .then((admin) => {
      mockAuth.mockResolvedValue({
        user: {
          id: admin.id,
          role: "ADMIN",
          name: "A",
          email: "a@example.com",
          image: null,
          githubLogin: "adm",
        },
      });
    });
}

describe("GET /api/components/:slug", () => {
  it("returns the full detail shape", async (ctx) => {
    if (!available) return ctx.skip();
    await seed("pdf-extractor");

    const res = await get("pdf-extractor");
    expect(res.status).toBe(200);

    const { data } = (await res.json()) as { data: Record<string, unknown> };
    expect(data).toMatchObject({
      slug: "pdf-extractor",
      type: "SKILL",
      urlType: "skill",
      license: "MIT",
      versionCount: 1,
    });
    expect(data.latestVersion).toMatchObject({
      version: "1.2.0",
      sizeBytes: 20_481,
      downloadUrl: "/api/components/pdf-extractor/versions/1.2.0/download",
    });
  });

  it("returns the README as RAW markdown, never as HTML", async (ctx) => {
    if (!available) return ctx.skip();
    await seed("pdf-extractor", { readme: "# Title\n\n<img src=x onerror=alert(1)>" });

    const { data } = (await (await get("pdf-extractor")).json()) as {
      data: { readme: string };
    };

    // Sanitization happens once, at render. If the API pre-rendered HTML there
    // would be two places to get XSS wrong instead of one (docs/03 §3.5).
    expect(data.readme).toContain("# Title");
    expect(data.readme).toContain("<img src=x onerror=alert(1)>");
  });

  it("404s for a slug that does not exist", async (ctx) => {
    if (!available) return ctx.skip();

    const res = await get("never-existed");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "NOT_FOUND",
    );
  });

  it("rejects a malformed slug without touching the database", async (ctx) => {
    if (!available) return ctx.skip();

    // A path segment that could never have been published — the schema throws
    // rather than degrading, because this is a broken link, not a filter.
    const res = await get("Not A Valid Slug!");
    expect(res.status).toBe(400);
  });
});

describe("[F4.7] hidden components are indistinguishable from missing ones", () => {
  it("404s a SUSPENDED component for an anonymous visitor", async (ctx) => {
    if (!available) return ctx.skip();
    await seed("naughty", { status: "SUSPENDED" });

    const res = await get("naughty");

    // 404 and NOT 403. A 403 would confirm the slug exists, turning the
    // endpoint into an enumeration oracle (rules/50).
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
  });

  it("404s a soft-deleted component", async (ctx) => {
    if (!available) return ctx.skip();
    await seed("gone", { deleted: true });

    expect((await get("gone")).status).toBe(404);
  });

  it("gives byte-identical responses for hidden and never-existed", async (ctx) => {
    if (!available) return ctx.skip();
    await seed("suspended-one", { status: "SUSPENDED" });

    const hidden = await get("suspended-one");
    const missing = await get("no-such-thing");

    // Any difference — status, code, message — leaks which slugs are real.
    expect(hidden.status).toBe(missing.status);
    const a = (await hidden.json()) as { error: { code: string; message: string } };
    const b = (await missing.json()) as { error: { code: string; message: string } };
    expect(a.error.code).toBe(b.error.code);
    expect(a.error.message).toBe(b.error.message);
  });

  it("shows a SUSPENDED component to an ADMIN", async (ctx) => {
    if (!available) return ctx.skip();
    await seed("naughty", { status: "SUSPENDED" });
    await asAdmin();

    const res = await get("naughty");
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { status: string } };
    expect(data.status).toBe("SUSPENDED");
  });
});
