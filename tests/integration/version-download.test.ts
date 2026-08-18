import { createHash } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import {
  testDb,
  databaseAvailable,
  storageAvailable,
  resetDatabase,
  closeTestDb,
} from "./_helpers";

/**
 * GET /api/components/:slug/versions/:version/download
 *
 * Spec: docs/03-api-contract.md §3.9
 * Features: F4.9
 */

const mockAuth = vi.fn();
vi.mock("@/server/auth/config", () => ({ auth: () => mockAuth() }));

const { componentKey } = await import("@/domain/storage-keys");
const { putObject } = await import("@/server/storage/storage.service");

let available = false;
let userId = "";
const ARCHIVE = Buffer.from("PK component archive bytes");
const CLIENT_IP = "198.51.100.7";

beforeAll(async () => {
  available = (await databaseAvailable()) && (await storageAvailable());
}, 60_000);

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  mockAuth.mockReset();
  mockAuth.mockResolvedValue(null);
  if (!available) return;

  await resetDatabase();
  const user = await testDb.user.create({
    data: { email: "d@x.com", githubLogin: "downloader", role: "USER" },
  });
  userId = user.id;
});

function signIn(id = userId, role: "USER" | "ADMIN" = "USER") {
  mockAuth.mockResolvedValue({
    user: { id, role, name: "D", email: "d@x.com", image: null, githubLogin: "d" },
  });
}

async function seed(
  slug = "pdf-extractor",
  status: "PUBLISHED" | "SUSPENDED" = "PUBLISHED",
) {
  const key = componentKey(slug, "1.0.0");
  await putObject(key, ARCHIVE);

  const component = await testDb.component.create({
    data: {
      slug,
      name: slug,
      displayName: "PDF Extractor",
      type: "SKILL",
      summary: "Extracts text from PDFs, reliably.",
      license: "MIT",
      ownerId: userId,
      status,
    },
  });
  const version = await testDb.componentVersion.create({
    data: {
      componentId: component.id,
      version: "1.0.0",
      manifest: {},
      objectKey: key,
      sizeBytes: ARCHIVE.byteLength,
      checksumSha256: slug.padEnd(64, "c"),
      publishedById: userId,
    },
  });
  await testDb.component.update({
    where: { id: component.id },
    data: { latestVersionId: version.id },
  });
}

async function download(slug: string, version: string) {
  const { GET } =
    await import("@/app/api/components/[slug]/versions/[version]/download/route");
  return GET(
    new Request(
      `http://localhost:3000/api/components/${slug}/versions/${version}/download`,
      {
        headers: {
          "x-forwarded-for": `${CLIENT_IP}, 10.0.0.1`,
          "user-agent": "vitest/1.0",
        },
      },
    ),
    { params: Promise.resolve({ slug, version }) },
  );
}

describe("[F4.9] version download", () => {
  it("rejects an anonymous request with 401 and records nothing", async (ctx) => {
    if (!available) return ctx.skip();
    await seed();

    expect((await download("pdf-extractor", "1.0.0")).status).toBe(401);
    expect(await testDb.download.count()).toBe(0);
  });

  it("redirects a signed-in user and serves the real bytes", async (ctx) => {
    if (!available) return ctx.skip();
    await seed();
    signIn();

    const res = await download("pdf-extractor", "1.0.0");
    expect(res.status).toBe(302);
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const location = res.headers.get("Location") ?? "";
    expect(location).toContain("X-Amz-Signature=");

    // Follow it for real — everything above could pass with a malformed URL.
    const archive = await fetch(location);
    expect(archive.status).toBe(200);
    expect(Buffer.from(await archive.arrayBuffer())).toEqual(ARCHIVE);
  }, 60_000);

  it("increments the component counter and writes a Download row", async (ctx) => {
    if (!available) return ctx.skip();
    await seed();
    signIn();

    await download("pdf-extractor", "1.0.0");

    const component = await testDb.component.findUnique({
      where: { slug: "pdf-extractor" },
    });
    expect(component?.downloadCount).toBe(1);

    const row = await testDb.download.findFirst();
    expect(row?.kind).toBe("COMPONENT");
    expect(row?.userId).toBe(userId);
    expect(row?.versionId).not.toBeNull();
  });

  it("stores a salted IP hash, never the address", async (ctx) => {
    if (!available) return ctx.skip();
    await seed();
    signIn();

    await download("pdf-extractor", "1.0.0");
    const row = await testDb.download.findFirst();
    const ipHash = row?.ipHash ?? "";

    expect(ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(ipHash).not.toContain(CLIENT_IP);
    // Unsalted would be trivially reversible across the whole IPv4 space.
    expect(ipHash).not.toBe(createHash("sha256").update(CLIENT_IP).digest("hex"));
  });

  it("404s an unknown version", async (ctx) => {
    if (!available) return ctx.skip();
    await seed();
    signIn();

    expect((await download("pdf-extractor", "9.9.9")).status).toBe(404);
  });

  it("404s a SUSPENDED component for a normal user, but serves an ADMIN", async (ctx) => {
    if (!available) return ctx.skip();
    await seed("naughty", "SUSPENDED");

    signIn();
    expect((await download("naughty", "1.0.0")).status).toBe(404);

    const admin = await testDb.user.create({
      data: { email: "adm@x.com", githubLogin: "adm", role: "ADMIN" },
    });
    signIn(admin.id, "ADMIN");
    expect((await download("naughty", "1.0.0")).status).toBe(302);
  });

  it("rejects a malformed version instead of querying for it", async (ctx) => {
    if (!available) return ctx.skip();
    await seed();
    signIn();

    expect((await download("pdf-extractor", "not-a-version")).status).toBe(400);
  });
});
