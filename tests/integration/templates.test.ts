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
 * Template listing and gated download, against a real Postgres and MinIO.
 *
 * Only `auth()` is mocked — producing a session is Auth.js's job, reacting to
 * one correctly is ours. Everything below the route handler is real: the guard,
 * the service, the transaction, and the presigner.
 *
 * Spec: docs/03-api-contract.md §3.2–3.3, docs/04 Flow 2
 * Features: F2.12
 */

const mockAuth = vi.fn();
vi.mock("@/server/auth/config", () => ({ auth: () => mockAuth() }));

const { templateKey } = await import("@/domain/storage-keys");
const { putObject } = await import("@/server/storage/storage.service");

let available = false;
let userId = "";

const ARCHIVE = Buffer.from("PK pretend archive bytes");
const CLIENT_IP = "203.0.113.42";

beforeAll(async () => {
  available = (await databaseAvailable()) && (await storageAvailable());
}, 60_000);

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  mockAuth.mockReset();
  if (!available) return;

  await resetDatabase();

  const user = await testDb.user.create({
    data: { email: "dl@example.com", githubLogin: "dl-tester", name: "DL", role: "USER" },
  });
  userId = user.id;

  // One real object per template, so the presigned URL points at bytes that
  // actually exist.
  for (const [dbType, urlType] of [
    ["SKILL", "skill"],
    ["PLUGIN", "plugin"],
    ["AGENT", "agent"],
    ["MCP_GATEWAY", "mcp-gateway"],
  ] as const) {
    const key = templateKey(urlType, "1.0.0");
    await putObject(key, ARCHIVE);
    await testDb.template.create({
      data: {
        type: dbType,
        name: `${urlType} Template`,
        description: `Starter ${urlType}.`,
        version: "1.0.0",
        objectKey: key,
        sizeBytes: ARCHIVE.byteLength,
        checksumSha256: createHash("sha256")
          .update(`${urlType}${ARCHIVE.toString()}`)
          .digest("hex"),
      },
    });
  }
}, 60_000);

function signedIn() {
  mockAuth.mockResolvedValue({
    user: {
      id: userId,
      role: "USER",
      name: "DL",
      email: "dl@example.com",
      image: null,
      githubLogin: "dl-tester",
    },
  });
}

function downloadRequest() {
  return new Request("http://localhost:3000/api/templates/mcp-gateway/download", {
    headers: { "x-forwarded-for": `${CLIENT_IP}, 70.41.3.18`, "user-agent": "vitest/1.0" },
  });
}

describe("[F2.12] GET /api/templates", () => {
  it("lists all four templates without requiring a session", async (ctx) => {
    if (!available) return ctx.skip();
    mockAuth.mockResolvedValue(null);

    const { GET } = await import("@/app/api/templates/route");
    const res = await GET(new Request("http://localhost:3000/api/templates"), {});

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(4);

    // Discovery is the point: a logged-out visitor must be able to see what
    // they would get before signing up (docs/07 §5).
    const gateway = body.data.find((t) => t.urlType === "mcp-gateway");
    expect(gateway?.downloadUrl).toBe("/api/templates/mcp-gateway/download");
    expect(gateway?.type).toBe("MCP_GATEWAY");
  });
});

describe("[F2.12] GET /api/templates/:type/download", () => {
  it("rejects an anonymous request with 401 and records nothing", async (ctx) => {
    if (!available) return ctx.skip();
    mockAuth.mockResolvedValue(null);

    const { GET } = await import("@/app/api/templates/[type]/download/route");
    const res = await GET(downloadRequest(), {
      params: Promise.resolve({ type: "mcp-gateway" }),
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHENTICATED");

    // An unauthorized attempt must not appear in the analytics.
    expect(await testDb.download.count()).toBe(0);
    const template = await testDb.template.findUnique({ where: { type: "MCP_GATEWAY" } });
    expect(template?.downloadCount).toBe(0);
  });

  it("redirects a signed-in user to a presigned URL and counts the download", async (ctx) => {
    if (!available) return ctx.skip();
    signedIn();

    const { GET } = await import("@/app/api/templates/[type]/download/route");
    const res = await GET(downloadRequest(), {
      params: Promise.resolve({ type: "mcp-gateway" }),
    });

    expect(res.status).toBe(302);

    const location = res.headers.get("Location") ?? "";
    expect(location).toContain("templates/mcp-gateway/1.0.0/");
    expect(location).toContain("X-Amz-Signature=");
    // The filename the browser saves, not the opaque object key.
    expect(decodeURIComponent(location)).toContain("mcp-gateway-template-1.0.0.zip");

    // A cached 302 would hand the next user an expired signature (docs/04 Flow 2).
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const downloads = await testDb.download.findMany();
    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.kind).toBe("TEMPLATE");
    expect(downloads[0]?.userId).toBe(userId);
    expect(downloads[0]?.userAgent).toBe("vitest/1.0");

    const template = await testDb.template.findUnique({ where: { type: "MCP_GATEWAY" } });
    expect(template?.downloadCount).toBe(1);

    // Follow the redirect for real. Everything above could pass while the
    // signature was malformed or pointed at a key that does not exist — this is
    // the only assertion that proves a user actually gets the archive.
    const archive = await fetch(location);
    expect(archive.status).toBe(200);
    expect(Buffer.from(await archive.arrayBuffer())).toEqual(ARCHIVE);
    expect(archive.headers.get("content-disposition")).toContain(
      "mcp-gateway-template-1.0.0.zip",
    );
  });

  it("stores a salted hash of the IP, never the address itself", async (ctx) => {
    if (!available) return ctx.skip();
    signedIn();

    const { GET } = await import("@/app/api/templates/[type]/download/route");
    await GET(downloadRequest(), { params: Promise.resolve({ type: "mcp-gateway" }) });

    const download = await testDb.download.findFirst();
    const ipHash = download?.ipHash ?? "";

    expect(ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(ipHash).not.toContain(CLIENT_IP);

    // The unsalted digest must NOT match: without a salt the IPv4 space is
    // small enough to enumerate, so an unsalted hash is not anonymisation.
    expect(ipHash).not.toBe(createHash("sha256").update(CLIENT_IP).digest("hex"));

    // The first x-forwarded-for entry is the real client, not the proxy.
    const salted = createHash("sha256")
      .update(`${CLIENT_IP}${process.env.DOWNLOAD_IP_SALT ?? ""}`)
      .digest("hex");
    expect(ipHash).toBe(salted);
  });

  it("increments the counter once per download, not once per request line", async (ctx) => {
    if (!available) return ctx.skip();
    signedIn();

    const { GET } = await import("@/app/api/templates/[type]/download/route");
    for (let i = 0; i < 3; i += 1) {
      await GET(downloadRequest(), { params: Promise.resolve({ type: "mcp-gateway" }) });
    }

    const template = await testDb.template.findUnique({ where: { type: "MCP_GATEWAY" } });
    expect(template?.downloadCount).toBe(3);
    expect(await testDb.download.count()).toBe(3);

    // Only the requested type moved.
    const skill = await testDb.template.findUnique({ where: { type: "SKILL" } });
    expect(skill?.downloadCount).toBe(0);
  });

  it("rejects an unknown type with a validation error, not a 500", async (ctx) => {
    if (!available) return ctx.skip();
    signedIn();

    const { GET } = await import("@/app/api/templates/[type]/download/route");
    const res = await GET(
      new Request("http://localhost:3000/api/templates/wordpress-plugin/download"),
      { params: Promise.resolve({ type: "wordpress-plugin" }) },
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string }; requestId: string };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.requestId).toBeTruthy();
    expect(await testDb.download.count()).toBe(0);
  });

  it("404s for a valid type that has no template row", async (ctx) => {
    if (!available) return ctx.skip();
    signedIn();
    await testDb.template.delete({ where: { type: "AGENT" } });

    const { GET } = await import("@/app/api/templates/[type]/download/route");
    const res = await GET(
      new Request("http://localhost:3000/api/templates/agent/download"),
      {
        params: Promise.resolve({ type: "agent" }),
      },
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });
});
