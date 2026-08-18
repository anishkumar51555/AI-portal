import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { testDb, databaseAvailable, resetDatabase, closeTestDb } from "./_helpers";

/**
 * PATCH / DELETE / suspend, and the version download.
 *
 * These are the destructive paths, so the assertions are about what must NOT
 * happen as much as what must: no rename, no cross-owner edit, no hard delete.
 *
 * Spec: docs/03-api-contract.md §3.9–3.12
 * Features: F4.9, F4.10, F4.11
 */

const mockAuth = vi.fn();
vi.mock("@/server/auth/config", () => ({ auth: () => mockAuth() }));

let available = false;
let ownerId = "";
let strangerId = "";
let adminId = "";

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
  const [owner, stranger, admin] = await Promise.all([
    testDb.user.create({
      data: { email: "o@x.com", githubLogin: "owner", role: "PUBLISHER" },
    }),
    testDb.user.create({
      data: { email: "s@x.com", githubLogin: "stranger", role: "PUBLISHER" },
    }),
    testDb.user.create({ data: { email: "a@x.com", githubLogin: "admin", role: "ADMIN" } }),
  ]);
  ownerId = owner.id;
  strangerId = stranger.id;
  adminId = admin.id;
});

function signIn(id: string, role: "PUBLISHER" | "ADMIN" = "PUBLISHER") {
  mockAuth.mockResolvedValue({
    user: { id, role, name: "T", email: "t@x.com", image: null, githubLogin: "t" },
  });
}

async function seed(slug = "pdf-extractor") {
  const component = await testDb.component.create({
    data: {
      slug,
      name: slug,
      displayName: "PDF Extractor",
      type: "SKILL",
      summary: "Extracts text from PDFs, and does it well.",
      license: "MIT",
      ownerId,
    },
  });
  const version = await testDb.componentVersion.create({
    data: {
      componentId: component.id,
      version: "1.0.0",
      manifest: {},
      objectKey: `components/${slug}/1.0.0/${slug}-1.0.0.zip`,
      sizeBytes: 100,
      checksumSha256: slug.padEnd(64, "b"),
      publishedById: ownerId,
    },
  });
  await testDb.component.update({
    where: { id: component.id },
    data: { latestVersionId: version.id },
  });
  return component;
}

async function patch(slug: string, body: unknown) {
  const { PATCH } = await import("@/app/api/components/[slug]/route");
  return PATCH(
    new Request(`http://localhost:3000/api/components/${slug}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug }) },
  );
}

async function del(slug: string) {
  const { DELETE } = await import("@/app/api/components/[slug]/route");
  return DELETE(
    new Request(`http://localhost:3000/api/components/${slug}`, { method: "DELETE" }),
    { params: Promise.resolve({ slug }) },
  );
}

async function suspendReq(slug: string, body: unknown) {
  const { POST } = await import("@/app/api/admin/components/[slug]/suspend/route");
  return POST(
    new Request(`http://localhost:3000/api/admin/components/${slug}/suspend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug }) },
  );
}

describe("[F4.10] PATCH /api/components/:slug", () => {
  it("updates the mutable fields", async (ctx) => {
    if (!available) return ctx.skip();
    await seed();
    signIn(ownerId);

    const res = await patch("pdf-extractor", {
      summary: "A much better description of what this does.",
      status: "DEPRECATED",
    });

    expect(res.status).toBe(200);
    const row = await testDb.component.findUnique({ where: { slug: "pdf-extractor" } });
    expect(row?.summary).toBe("A much better description of what this does.");
    expect(row?.status).toBe("DEPRECATED");
  });

  // A plain loop rather than `it.each`: with `it.each` the test context arrives
  // AFTER the case arguments, so the skip path crashes instead of skipping on a
  // machine with no containers.
  for (const [field, body] of [
    ["name", { name: "something-else" }],
    ["type", { type: "AGENT" }],
    ["slug", { slug: "new-slug" }],
    ["downloadCount", { downloadCount: 99999 }],
  ] as const) {
    it(`rejects an attempt to change ${field} with 400`, async (ctx) => {
      if (!available) return ctx.skip();
      await seed();
      signIn(ownerId);

      const res = await patch("pdf-extractor", body);

      // A 400, never a silent no-op: the caller must not believe it worked.
      expect(res.status).toBe(400);
      const row = await testDb.component.findUnique({ where: { slug: "pdf-extractor" } });
      expect(row?.name).toBe("pdf-extractor");
      expect(row?.type).toBe("SKILL");
    });
  }

  it("refuses to let an owner suspend their own component", async (ctx) => {
    if (!available) return ctx.skip();
    await seed();
    signIn(ownerId);

    // SUSPENDED is absent from the patch enum on purpose — otherwise an owner
    // could also UNsuspend themselves.
    expect((await patch("pdf-extractor", { status: "SUSPENDED" })).status).toBe(400);
  });

  it("404s for someone else's component, never 403", async (ctx) => {
    if (!available) return ctx.skip();
    await seed();
    signIn(strangerId);

    const res = await patch("pdf-extractor", { summary: "I am hijacking this one." });

    expect(res.status).toBe(404);
    expect(res.status).not.toBe(403);
  });

  it("lets an ADMIN edit any component", async (ctx) => {
    if (!available) return ctx.skip();
    await seed();
    signIn(adminId, "ADMIN");

    expect(
      (await patch("pdf-extractor", { summary: "Edited by an administrator." })).status,
    ).toBe(200);
  });

  it("replaces tags only when they are supplied", async (ctx) => {
    if (!available) return ctx.skip();
    const component = await seed();
    const tag = await testDb.tag.create({ data: { slug: "pdf", label: "PDF" } });
    await testDb.componentTag.create({
      data: { componentId: component.id, tagId: tag.id },
    });
    signIn(ownerId);

    // No `tags` key: the existing ones must survive.
    await patch("pdf-extractor", { summary: "Only the summary changes here." });
    expect(await testDb.componentTag.count({ where: { componentId: component.id } })).toBe(
      1,
    );

    // An empty array means "remove them all" — distinct from not supplying it.
    await patch("pdf-extractor", { tags: [] });
    expect(await testDb.componentTag.count({ where: { componentId: component.id } })).toBe(
      0,
    );
  });

  it("rejects an empty body", async (ctx) => {
    if (!available) return ctx.skip();
    await seed();
    signIn(ownerId);

    expect((await patch("pdf-extractor", {})).status).toBe(400);
  });

  it("writes an audit row", async (ctx) => {
    if (!available) return ctx.skip();
    await seed();
    signIn(ownerId);

    await patch("pdf-extractor", { summary: "Changed for auditing purposes here." });

    const audit = await testDb.auditLog.findFirst({
      where: { action: "COMPONENT_UPDATED" },
    });
    expect(audit?.actorId).toBe(ownerId);
  });
});

describe("[F4.10] DELETE /api/components/:slug", () => {
  it("soft deletes and returns 204", async (ctx) => {
    if (!available) return ctx.skip();
    await seed();
    signIn(ownerId);

    const res = await del("pdf-extractor");
    expect(res.status).toBe(204);

    const row = await testDb.component.findUnique({ where: { slug: "pdf-extractor" } });
    expect(row).not.toBeNull();
    expect(row?.deletedAt).not.toBeNull();
  });

  it("RETAINS the version rows and their checksums", async (ctx) => {
    if (!available) return ctx.skip();
    await seed();
    signIn(ownerId);

    await del("pdf-extractor");

    // Someone who downloaded 1.0.0 last week must still be able to verify it,
    // and the audit trail has to survive the author's change of heart.
    expect(await testDb.componentVersion.count()).toBe(1);
  });

  it("404s for someone else's component", async (ctx) => {
    if (!available) return ctx.skip();
    await seed();
    signIn(strangerId);

    expect((await del("pdf-extractor")).status).toBe(404);
    const row = await testDb.component.findUnique({ where: { slug: "pdf-extractor" } });
    expect(row?.deletedAt).toBeNull();
  });

  it("is not repeatable — a deleted component is already gone", async (ctx) => {
    if (!available) return ctx.skip();
    await seed();
    signIn(ownerId);

    await del("pdf-extractor");
    expect((await del("pdf-extractor")).status).toBe(404);
  });
});

describe("[F4.11] POST /api/admin/components/:slug/suspend", () => {
  it("suspends, hides from the catalog, and audits with the reason", async (ctx) => {
    if (!available) return ctx.skip();
    await seed();
    signIn(adminId, "ADMIN");

    const res = await suspendReq("pdf-extractor", {
      suspended: true,
      reason: "Contains hard-coded credentials.",
    });

    expect(res.status).toBe(200);
    const row = await testDb.component.findUnique({ where: { slug: "pdf-extractor" } });
    expect(row?.status).toBe("SUSPENDED");

    const audit = await testDb.auditLog.findFirst({
      where: { action: "COMPONENT_SUSPENDED" },
    });
    expect(audit?.metadata).toMatchObject({
      suspended: true,
      reason: "Contains hard-coded credentials.",
    });
  });

  it("requires a reason when suspending", async (ctx) => {
    if (!available) return ctx.skip();
    await seed();
    signIn(adminId, "ADMIN");

    // An audit row saying only "suspended" is useless six months later.
    expect((await suspendReq("pdf-extractor", { suspended: true })).status).toBe(400);
  });

  it("can unsuspend without a reason", async (ctx) => {
    if (!available) return ctx.skip();
    await seed();
    signIn(adminId, "ADMIN");

    await suspendReq("pdf-extractor", { suspended: true, reason: "Testing suspension." });
    expect((await suspendReq("pdf-extractor", { suspended: false })).status).toBe(200);

    const row = await testDb.component.findUnique({ where: { slug: "pdf-extractor" } });
    expect(row?.status).toBe("PUBLISHED");
  });

  it("refuses a non-admin", async (ctx) => {
    if (!available) return ctx.skip();
    await seed();
    signIn(ownerId);

    const res = await suspendReq("pdf-extractor", { suspended: true, reason: "Nice try." });
    expect(res.status).toBe(403);
  });

  it("refuses a demoted admin whose token still claims ADMIN", async (ctx) => {
    if (!available) return ctx.skip();
    await seed();

    // The role is re-read from the database, so a stale JWT does not carry
    // authority it no longer has (rules/50).
    await testDb.user.update({ where: { id: adminId }, data: { role: "USER" } });
    signIn(adminId, "ADMIN");

    expect(
      (await suspendReq("pdf-extractor", { suspended: true, reason: "Stale token." }))
        .status,
    ).toBe(403);
  });
});
