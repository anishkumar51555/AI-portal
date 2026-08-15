import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { testDb, databaseAvailable, resetDatabase, closeTestDb } from "./_helpers";

/**
 * GET /api/me/components — the dashboard's data.
 *
 * The interesting rule is the inverse of every other read path: this one must
 * NOT hide suspended or soft-deleted components, because the owner is exactly
 * the person who needs to know what happened to them.
 *
 * Spec: docs/03-api-contract.md §3.13
 */

const mockAuth = vi.fn();
vi.mock("@/server/auth/config", () => ({ auth: () => mockAuth() }));

let available = false;
let userId = "";

beforeAll(async () => {
  available = await databaseAvailable();
}, 60_000);

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  mockAuth.mockReset();
  if (!available) return;

  await resetDatabase();
  const user = await testDb.user.create({
    data: { email: "me@example.com", githubLogin: "me", role: "PUBLISHER" },
  });
  userId = user.id;
});

function signedIn(id = userId) {
  mockAuth.mockResolvedValue({
    user: {
      id,
      role: "PUBLISHER",
      name: "Me",
      email: "me@example.com",
      image: null,
      githubLogin: "me",
    },
  });
}

async function get() {
  const { GET } = await import("@/app/api/me/components/route");
  return GET(new Request("http://localhost:3000/api/me/components"), {});
}

/** A component owned by `ownerId`, with one version. */
async function seedComponent(
  ownerId: string,
  overrides: Partial<{
    slug: string;
    status: "PUBLISHED" | "SUSPENDED";
    deletedAt: Date;
  }> = {},
) {
  const slug = overrides.slug ?? "pdf-extractor";
  const component = await testDb.component.create({
    data: {
      slug,
      name: slug,
      displayName: "PDF Extractor",
      type: "SKILL",
      summary: "Extracts text from PDFs.",
      license: "MIT",
      ownerId,
      status: overrides.status ?? "PUBLISHED",
      deletedAt: overrides.deletedAt ?? null,
    },
  });

  const version = await testDb.componentVersion.create({
    data: {
      componentId: component.id,
      version: "1.0.0",
      manifest: {},
      objectKey: `components/${slug}/1.0.0/${slug}-1.0.0.zip`,
      sizeBytes: 1024,
      checksumSha256: `${slug}`.padEnd(64, "0"),
      publishedById: ownerId,
    },
  });

  await testDb.component.update({
    where: { id: component.id },
    data: { latestVersionId: version.id },
  });

  return component;
}

describe("GET /api/me/components", () => {
  it("requires a session", async (ctx) => {
    if (!available) return ctx.skip();
    mockAuth.mockResolvedValue(null);

    expect((await get()).status).toBe(401);
  });

  it("returns an empty list for someone who has published nothing", async (ctx) => {
    if (!available) return ctx.skip();
    signedIn();

    const res = await get();
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: unknown[] }).data).toEqual([]);
  });

  it("returns the caller's components with version and download counts", async (ctx) => {
    if (!available) return ctx.skip();
    signedIn();
    await seedComponent(userId);

    const res = await get();
    const { data } = (await res.json()) as { data: Array<Record<string, unknown>> };

    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({
      slug: "pdf-extractor",
      type: "SKILL",
      urlType: "skill",
      latestVersion: "1.0.0",
      versionCount: 1,
      isDeleted: false,
    });
  });

  it("shows suspended and soft-deleted components, unlike every other read path", async (ctx) => {
    if (!available) return ctx.skip();
    signedIn();

    await seedComponent(userId, { slug: "suspended-one", status: "SUSPENDED" });
    await seedComponent(userId, { slug: "deleted-one", deletedAt: new Date() });

    const res = await get();
    const { data } = (await res.json()) as {
      data: Array<{ slug: string; status: string; isDeleted: boolean }>;
    };

    // The catalog hides both. The owner's dashboard must not — "where did my
    // component go?" is a worse experience than seeing it flagged.
    expect(data.map((c) => c.slug).sort()).toEqual(["deleted-one", "suspended-one"]);
    expect(data.find((c) => c.slug === "suspended-one")?.status).toBe("SUSPENDED");
    expect(data.find((c) => c.slug === "deleted-one")?.isDeleted).toBe(true);
  });

  it("never returns another user's components", async (ctx) => {
    if (!available) return ctx.skip();

    const stranger = await testDb.user.create({
      data: { email: "other@example.com", githubLogin: "other", role: "PUBLISHER" },
    });
    await seedComponent(stranger.id, { slug: "not-mine" });
    await seedComponent(userId, { slug: "mine" });

    signedIn();
    const res = await get();
    const { data } = (await res.json()) as { data: Array<{ slug: string }> };

    expect(data.map((c) => c.slug)).toEqual(["mine"]);
  });
});
