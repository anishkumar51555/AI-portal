import { createHash } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { ZipArchive } from "archiver";
import {
  testDb,
  databaseAvailable,
  storageAvailable,
  resetDatabase,
  closeTestDb,
} from "./_helpers";

/**
 * The publish pipeline, end to end against a real Postgres and MinIO.
 *
 * This is the flow the whole project exists for, and almost every assertion
 * here is one a mock could not make: that the transaction is genuinely atomic,
 * that storage is promoted before the database commits, and that a rejected
 * upload leaves nothing behind.
 *
 * Spec: docs/03-api-contract.md §3.7–3.8 · docs/04 Flow 3
 * Features: F3.12–F3.20
 */

const mockAuth = vi.fn();
vi.mock("@/server/auth/config", () => ({ auth: () => mockAuth() }));

const { stagingKey } = await import("@/domain/storage-keys");
const { putObject, headObject } = await import("@/server/storage/storage.service");

let available = false;
let userId = "";

const FIXED_DATE = new Date("2026-01-01T00:00:00.000Z");

/** A minimal but genuinely valid skill manifest. */
function skillManifest(overrides: Record<string, unknown> = {}) {
  return {
    specVersion: "1.0",
    name: "pdf-extractor",
    displayName: "PDF Extractor",
    version: "1.0.0",
    description: "Extracts structured text and tables from PDF documents reliably.",
    author: { name: "Test Publisher" },
    license: "MIT",
    keywords: ["pdf", "extraction"],
    runtime: { language: "typescript" },
    entrypoint: "src/index.ts",
    type: "skill",
    skill: {
      instructions: "SKILL.md",
      triggers: ["When the user asks to extract text from a PDF"],
    },
    ...overrides,
  };
}

/** Build a real zip in memory, deterministic so checksums are predictable. */
async function buildArchive(manifest: unknown, extra: Record<string, string> = {}) {
  const chunks: Buffer[] = [];
  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.on("data", (c: Buffer) => chunks.push(c));

  const files: Record<string, string> = {
    "component.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "README.md": "# PDF Extractor\n\nExtracts text.\n",
    "SKILL.md": "# Instructions\n\nDo the thing.\n",
    "src/index.ts": "export const run = () => null;\n",
    ...extra,
  };
  for (const [name, body] of Object.entries(files)) {
    archive.append(body, { name, date: FIXED_DATE });
  }

  await archive.finalize();
  const bytes = Buffer.concat(chunks);
  return { bytes, checksum: createHash("sha256").update(bytes).digest("hex") };
}

/** Stage an archive exactly where a real presigned upload would have put it. */
async function stage(bytes: Buffer, owner = userId): Promise<string> {
  const key = stagingKey(owner);
  await putObject(key, bytes);
  return key;
}

function signedIn(id = userId, role: "USER" | "PUBLISHER" | "ADMIN" = "USER") {
  mockAuth.mockResolvedValue({
    user: {
      id,
      role,
      name: "Pub",
      email: "pub@example.com",
      image: null,
      githubLogin: "pub",
    },
  });
}

async function publish(body: unknown) {
  const { POST } = await import("@/app/api/components/route");
  return POST(
    new Request("http://localhost:3000/api/components", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    {},
  );
}

async function publishVersionOf(slug: string, body: unknown) {
  const { POST } = await import("@/app/api/components/[slug]/versions/route");
  return POST(
    new Request(`http://localhost:3000/api/components/${slug}/versions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug }) },
  );
}

beforeAll(async () => {
  available = (await databaseAvailable()) && (await storageAvailable());
}, 60_000);

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  mockAuth.mockReset();
  vi.unstubAllEnvs();
  if (!available) return;

  await resetDatabase();
  const user = await testDb.user.create({
    data: { email: "pub@example.com", githubLogin: "pub", name: "Pub", role: "USER" },
  });
  userId = user.id;
});

describe("[F3.13] a valid publish writes everything in one transaction", () => {
  it("creates the component, version, tags, audit row, and promotes the owner", async (ctx) => {
    if (!available) return ctx.skip();
    signedIn();

    const { bytes, checksum } = await buildArchive(skillManifest());
    const key = await stage(bytes);

    const res = await publish({ stagingKey: key, tags: ["pdf"], changelog: "Initial." });

    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: Record<string, string> };
    expect(data.slug).toBe("pdf-extractor");
    expect(data.version).toBe("1.0.0");
    expect(data.url).toBe("/components/pdf-extractor");
    expect(data.checksumSha256).toBe(checksum);

    const component = await testDb.component.findUnique({
      where: { slug: "pdf-extractor" },
      include: { versions: true, tags: { include: { tag: true } }, latestVersion: true },
    });

    expect(component).not.toBeNull();
    expect(component?.type).toBe("SKILL");
    // Everything descriptive comes from the MANIFEST, never the request body.
    expect(component?.summary).toContain("Extracts structured text");
    expect(component?.readme).toContain("# PDF Extractor");
    expect(component?.versions).toHaveLength(1);

    // The denormalized pointer is written in the same transaction, so it can
    // never dangle (docs/02 §2.1).
    expect(component?.latestVersionId).toBe(component?.versions[0]?.id);
    expect(component?.latestVersion?.version).toBe("1.0.0");

    // Requested tags plus the manifest's own keywords.
    const tagSlugs = (component?.tags ?? []).map((t) => t.tag.slug).sort();
    expect(tagSlugs).toEqual(["extraction", "pdf"]);

    const audit = await testDb.auditLog.findFirst({
      where: { action: "COMPONENT_PUBLISHED" },
    });
    expect(audit?.targetId).toBe(component?.id);
  }, 60_000);

  it("[F3.20] promotes the owner from USER to PUBLISHER", async (ctx) => {
    if (!available) return ctx.skip();
    signedIn();

    expect((await testDb.user.findUnique({ where: { id: userId } }))?.role).toBe("USER");

    const { bytes } = await buildArchive(skillManifest());
    await publish({ stagingKey: await stage(bytes) });

    // Without this the author cannot publish their own next version.
    expect((await testDb.user.findUnique({ where: { id: userId } }))?.role).toBe(
      "PUBLISHER",
    );
  }, 60_000);

  it("never demotes an ADMIN who publishes", async (ctx) => {
    if (!available) return ctx.skip();

    const admin = await testDb.user.create({
      data: { email: "a@example.com", githubLogin: "adm", role: "ADMIN" },
    });
    signedIn(admin.id, "ADMIN");

    const { bytes } = await buildArchive(skillManifest());
    await publish({ stagingKey: await stage(bytes, admin.id) });

    expect((await testDb.user.findUnique({ where: { id: admin.id } }))?.role).toBe("ADMIN");
  }, 60_000);
});

describe("[F3.15] the staging object is removed on both paths", () => {
  it("deletes staging after a successful publish", async (ctx) => {
    if (!available) return ctx.skip();
    signedIn();

    const { bytes } = await buildArchive(skillManifest());
    const key = await stage(bytes);

    expect(await headObject(key)).not.toBeNull();
    await publish({ stagingKey: key });

    expect(await headObject(key)).toBeNull();
  }, 60_000);

  it("deletes staging after a REJECTED publish", async (ctx) => {
    if (!available) return ctx.skip();
    signedIn();

    // Forgetting this path is called out in the plan as the most common bug in
    // this phase: rejected archives would linger until the lifecycle sweep.
    const { bytes } = await buildArchive(skillManifest({ version: "not-semver" }));
    const key = await stage(bytes);

    const res = await publish({ stagingKey: key });

    expect(res.status).toBe(422);
    expect(await headObject(key)).toBeNull();
  }, 60_000);

  it("records an UPLOAD_REJECTED audit row when it rejects", async (ctx) => {
    if (!available) return ctx.skip();
    signedIn();

    const { bytes } = await buildArchive(skillManifest({ version: "not-semver" }));
    await publish({ stagingKey: await stage(bytes) });

    const audit = await testDb.auditLog.findFirst({ where: { action: "UPLOAD_REJECTED" } });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(userId);
  }, 60_000);
});

describe("[F3.14] an invalid manifest returns 422 and writes NO rows", () => {
  it("reports every field problem and leaves the database untouched", async (ctx) => {
    if (!available) return ctx.skip();
    signedIn();

    const { bytes } = await buildArchive(
      skillManifest({ version: "1.0", description: "short", license: "WTFPL" }),
    );

    const res = await publish({ stagingKey: await stage(bytes) });

    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: { code: string; details: Array<{ path: string }> };
    };
    expect(body.error.code).toBe("MANIFEST_INVALID");
    expect(body.error.details.map((d) => d.path)).toEqual(
      expect.arrayContaining(["version", "description", "license"]),
    );

    // Nothing partial may survive a rejection.
    expect(await testDb.component.count()).toBe(0);
    expect(await testDb.componentVersion.count()).toBe(0);
  }, 60_000);

  it("rejects an archive with no component.json", async (ctx) => {
    if (!available) return ctx.skip();
    signedIn();

    const chunks: Buffer[] = [];
    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on("data", (c: Buffer) => chunks.push(c));
    archive.append("# nothing here\n", { name: "README.md", date: FIXED_DATE });
    await archive.finalize();

    const res = await publish({ stagingKey: await stage(Buffer.concat(chunks)) });

    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "MANIFEST_MISSING",
    );
  }, 60_000);

  it("rejects a hostile archive before it reaches the database", async (ctx) => {
    if (!available) return ctx.skip();
    signedIn();

    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const bomb = readFileSync(join(process.cwd(), "tests/fixtures/archives/zip-slip.zip"));

    const res = await publish({ stagingKey: await stage(bomb) });

    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "ARCHIVE_UNSAFE",
    );
    expect(await testDb.component.count()).toBe(0);
  }, 60_000);
});

describe("the round trip the product promises", () => {
  it("publishes a portal template unchanged, straight out of the box", async (ctx) => {
    if (!available) return ctx.skip();
    signedIn();

    // "Download a template → build your component → publish it back" is the
    // three-step strip on /templates. If an UNMODIFIED template cannot complete
    // that loop, the promise on the landing page is false — so this asserts the
    // product's core claim rather than a unit of code.
    const { execFileSync } = await import("node:child_process");
    const { existsSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    const archivePath = join(process.cwd(), "templates/.dist/skill-template-1.0.0.zip");
    if (!existsSync(archivePath)) {
      execFileSync(process.execPath, ["--import", "tsx", "scripts/build-templates.mts"], {
        cwd: process.cwd(),
        stdio: "pipe",
      });
    }

    const res = await publish({
      stagingKey: await stage(readFileSync(archivePath)),
      tags: ["starter"],
    });

    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { slug: string; version: string } };
    expect(data.version).toBe("1.0.0");

    const component = await testDb.component.findUnique({ where: { slug: data.slug } });
    expect(component?.type).toBe("SKILL");
  }, 120_000);
});

describe("[F3.12] staging ownership", () => {
  it("refuses to publish another user's staged upload", async (ctx) => {
    if (!available) return ctx.skip();

    const victim = await testDb.user.create({
      data: { email: "v@example.com", githubLogin: "victim", role: "USER" },
    });
    const { bytes } = await buildArchive(skillManifest());
    const victimKey = await stage(bytes, victim.id);

    // The attacker is genuinely signed in — a session check catches nothing
    // here. Only the prefix assertion does (docs/08 §4, threat 6).
    signedIn();
    const res = await publish({ stagingKey: victimKey });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "STAGING_FORBIDDEN",
    );

    // And crucially: the victim's upload must still be there. Deleting it would
    // turn a failed attack into a successful denial of service.
    expect(await headObject(victimKey)).not.toBeNull();
  }, 60_000);

  it("404s a staging key that does not exist", async (ctx) => {
    if (!available) return ctx.skip();
    signedIn();

    const res = await publish({ stagingKey: stagingKey(userId) });

    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "STAGING_NOT_FOUND",
    );
  }, 60_000);
});

describe("[F3.17] uniqueness conflicts", () => {
  it("returns 409 SLUG_TAKEN for a name already published", async (ctx) => {
    if (!available) return ctx.skip();
    signedIn();

    const first = await buildArchive(skillManifest());
    await publish({ stagingKey: await stage(first.bytes) });

    // Same slug, different bytes — so this is a slug conflict, not a checksum one.
    const second = await buildArchive(skillManifest({ displayName: "Different Name" }));
    const res = await publish({ stagingKey: await stage(second.bytes) });

    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "SLUG_TAKEN",
    );
    expect(await testDb.component.count()).toBe(1);
  }, 60_000);

  it("returns 409 DUPLICATE_ARCHIVE when the same bytes are published twice", async (ctx) => {
    if (!available) return ctx.skip();
    signedIn();

    const { bytes } = await buildArchive(skillManifest());
    await publish({ stagingKey: await stage(bytes) });

    // Retrying an already-successful publish must not create a twin.
    const res = await publish({ stagingKey: await stage(bytes) });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; message: string } };

    // Both conditions hold on a retry, so the ORDER of the checks decides the
    // message. DUPLICATE_ARCHIVE names the component it already went out as;
    // SLUG_TAKEN would tell them to rename something that is already theirs.
    expect(body.error.code).toBe("DUPLICATE_ARCHIVE");
    expect(body.error.message).toContain("pdf-extractor@1.0.0");
    expect(await testDb.component.count()).toBe(1);
  }, 60_000);
});

describe("[F3.18] publishing a new version", () => {
  async function publishFirst() {
    signedIn();
    const { bytes } = await buildArchive(skillManifest());
    await publish({ stagingKey: await stage(bytes), tags: ["pdf"] });
  }

  it("accepts a strictly newer version and moves latestVersionId", async (ctx) => {
    if (!available) return ctx.skip();
    await publishFirst();

    const next = await buildArchive(skillManifest({ version: "1.1.0" }));
    const res = await publishVersionOf("pdf-extractor", {
      stagingKey: await stage(next.bytes),
      changelog: "Better tables.",
    });

    expect(res.status).toBe(201);

    const component = await testDb.component.findUnique({
      where: { slug: "pdf-extractor" },
      include: { versions: { orderBy: { version: "asc" } }, latestVersion: true },
    });
    expect(component?.versions).toHaveLength(2);
    expect(component?.latestVersion?.version).toBe("1.1.0");
  }, 60_000);

  it("rejects a version that is not newer, as a 409", async (ctx) => {
    if (!available) return ctx.skip();
    await publishFirst();

    const older = await buildArchive(skillManifest({ version: "0.9.0" }));
    const res = await publishVersionOf("pdf-extractor", {
      stagingKey: await stage(older.bytes),
    });

    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "VERSION_NOT_INCREASING",
    );
  }, 60_000);

  it("compares numerically — 1.10.0 is newer than 1.9.0", async (ctx) => {
    if (!available) return ctx.skip();
    signedIn();

    const first = await buildArchive(skillManifest({ version: "1.9.0" }));
    await publish({ stagingKey: await stage(first.bytes) });

    const next = await buildArchive(skillManifest({ version: "1.10.0" }));
    const res = await publishVersionOf("pdf-extractor", {
      stagingKey: await stage(next.bytes),
    });

    // String comparison would call this a downgrade and reject a real release.
    expect(res.status).toBe(201);
  }, 60_000);

  it("[F3.19] refuses to change the component's type", async (ctx) => {
    if (!available) return ctx.skip();
    await publishFirst();

    const mutated = await buildArchive(
      skillManifest({
        version: "2.0.0",
        type: "agent",
        skill: undefined,
        agent: {
          systemPrompt: "You are a helpful PDF agent doing useful work.",
          model: { provider: "anthropic", preferred: "claude-opus-5" },
          maxIterations: 5,
        },
      }),
    );

    const res = await publishVersionOf("pdf-extractor", {
      stagingKey: await stage(mutated.bytes),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { details: Array<{ path: string }> } };
    expect(body.error.details.map((d) => d.path)).toContain("type");

    // The published type is what a consumer depends on; it can never move.
    const component = await testDb.component.findUnique({
      where: { slug: "pdf-extractor" },
    });
    expect(component?.type).toBe("SKILL");
  }, 60_000);

  it("404s a version published against someone else's component", async (ctx) => {
    if (!available) return ctx.skip();
    await publishFirst();

    const stranger = await testDb.user.create({
      data: { email: "s@example.com", githubLogin: "stranger", role: "PUBLISHER" },
    });
    signedIn(stranger.id, "PUBLISHER");

    const next = await buildArchive(skillManifest({ version: "2.0.0" }));
    const res = await publishVersionOf("pdf-extractor", {
      stagingKey: await stage(next.bytes, stranger.id),
    });

    // 404, not 403: a 403 confirms the component exists and makes this an
    // enumeration oracle (rules/50).
    expect(res.status).toBe(404);
  }, 60_000);
});
