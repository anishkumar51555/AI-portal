import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import {
  testDb,
  databaseAvailable,
  storageAvailable,
  resetDatabase,
  closeTestDb,
} from "./_helpers";

/**
 * POST /api/uploads/presign, against a real Postgres and MinIO.
 *
 * The interesting assertions are the ones a mock could not make: that STORAGE
 * itself refuses an oversized body, and that the key the client gets back is
 * scoped to the caller no matter what they asked for.
 *
 * Spec: docs/03-api-contract.md §3.6 · docs/08 §4 threats 5–7
 * Features: F3.10, F3.11, F3.21
 */

const mockAuth = vi.fn();
vi.mock("@/server/auth/config", () => ({ auth: () => mockAuth() }));

let available = false;
let userId = "";

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
    data: { email: "up@example.com", githubLogin: "uploader", name: "Up", role: "USER" },
  });
  userId = user.id;
});

function signedIn(id = userId) {
  mockAuth.mockResolvedValue({
    user: {
      id,
      role: "USER",
      name: "Up",
      email: "up@example.com",
      image: null,
      githubLogin: "uploader",
    },
  });
}

function request(body: unknown) {
  return new Request("http://localhost:3000/api/uploads/presign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const VALID_BODY = {
  fileName: "pdf-extractor-1.0.0.zip",
  sizeBytes: 20_481,
  contentType: "application/zip",
};

async function post(body: unknown) {
  const { POST } = await import("@/app/api/uploads/presign/route");
  return POST(request(body), {});
}

describe("[F3.11] the server derives the key", () => {
  it("returns a staging key scoped to the caller", async (ctx) => {
    if (!available) return ctx.skip();
    signedIn();

    const res = await post(VALID_BODY);
    expect(res.status).toBe(200);

    const { data } = (await res.json()) as { data: Record<string, string> };
    expect(data.stagingKey).toMatch(
      new RegExp(`^staging/${userId}/[0-9A-HJKMNP-TV-Z]{26}\\.zip$`),
    );
    expect(data.uploadUrl).toBeTruthy();
    expect(Number(data.maxSizeBytes)).toBeGreaterThan(0);
  });

  it("ignores a client-supplied key instead of honouring it", async (ctx) => {
    if (!available) return ctx.skip();
    signedIn();

    // A client-chosen key is a bucket-wide write primitive: this one would
    // overwrite the official Skill template (docs/08 §4, threat 7). The schema
    // is `.strict()`, so the request is rejected outright rather than the field
    // being quietly dropped — which is the safer of the two failures.
    const res = await post({
      ...VALID_BODY,
      key: "templates/skill/1.0.0/skill-template-1.0.0.zip",
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; details?: unknown[] } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("gives a different key to every request", async (ctx) => {
    if (!available) return ctx.skip();
    signedIn();

    const keys = new Set<string>();
    for (let i = 0; i < 3; i += 1) {
      const res = await post(VALID_BODY);
      const { data } = (await res.json()) as { data: { stagingKey: string } };
      keys.add(data.stagingKey);
    }

    expect(keys.size).toBe(3);
  });
});

describe("authentication and validation", () => {
  it("rejects an anonymous request with 401", async (ctx) => {
    if (!available) return ctx.skip();
    mockAuth.mockResolvedValue(null);

    const res = await post(VALID_BODY);

    expect(res.status).toBe(401);
    // Nothing should have been counted against a nonexistent user.
    expect(await testDb.rateLimit.count()).toBe(0);
  });

  it("rejects a malformed JSON body with 400, not 500", async (ctx) => {
    if (!available) return ctx.skip();
    signedIn();

    const res = await post("{ not json");

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string }; requestId: string };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.requestId).toBeTruthy();
  });

  // Written as a loop of plain `it`s rather than `it.each`: with `it.each` the
  // test context arrives AFTER the case arguments, so the skip path would crash
  // rather than skip on a machine with no containers running.
  for (const [fileName, why] of [
    ["../../etc/passwd.zip", "traversal"],
    ["archive.tar.gz", "not a zip"],
    ["has spaces.zip", "space"],
  ] as const) {
    it(`rejects the file name "${fileName}" (${why})`, async (ctx) => {
      if (!available) return ctx.skip();
      signedIn();

      const res = await post({ ...VALID_BODY, fileName });
      expect(res.status).toBe(400);
    });
  }

  it("[F3.10] rejects an oversize declared size with 413", async (ctx) => {
    if (!available) return ctx.skip();
    signedIn();

    const res = await post({ ...VALID_BODY, sizeBytes: 50 * 1024 * 1024 });

    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("ARCHIVE_TOO_LARGE");
    // The message should tell them the limit AND what they sent.
    expect(body.error.message).toContain("MB");
  });

  it("rejects a non-zip content type", async (ctx) => {
    if (!available) return ctx.skip();
    signedIn();

    const res = await post({ ...VALID_BODY, contentType: "application/octet-stream" });
    expect(res.status).toBe(400);
  });
});

describe("[F3.10] storage enforces the size limit itself", () => {
  it("refuses a body larger than content-length-range, whatever the client claimed", async (ctx) => {
    if (!available) return ctx.skip();
    signedIn();

    // The client declares a small file and then uploads a big one. Nothing in
    // the application sees this second request — the bucket has to be the one
    // that says no, which is the entire reason for a presigned POST over a PUT.
    const res = await post({ ...VALID_BODY, sizeBytes: 1_024 });
    const { data } = (await res.json()) as {
      data: { uploadUrl: string; fields: Record<string, string>; maxSizeBytes: number };
    };

    const form = new FormData();
    for (const [name, value] of Object.entries(data.fields)) form.append(name, value);
    form.append(
      "file",
      new Blob([new Uint8Array(data.maxSizeBytes + 1_024)], { type: "application/zip" }),
      "big.zip",
    );

    const upload = await fetch(data.uploadUrl, { method: "POST", body: form });

    expect(upload.ok).toBe(false);
    expect(upload.status).toBeGreaterThanOrEqual(400);
  }, 60_000);

  it("accepts a body inside the range", async (ctx) => {
    if (!available) return ctx.skip();
    signedIn();

    const res = await post(VALID_BODY);
    const { data } = (await res.json()) as {
      data: { uploadUrl: string; fields: Record<string, string>; stagingKey: string };
    };

    const form = new FormData();
    for (const [name, value] of Object.entries(data.fields)) form.append(name, value);
    form.append(
      "file",
      new Blob([new Uint8Array(2_048)], { type: "application/zip" }),
      "ok.zip",
    );

    const upload = await fetch(data.uploadUrl, { method: "POST", body: form });

    expect(upload.ok).toBe(true);

    // And the object really landed under the caller's own prefix.
    const { headObject } = await import("@/server/storage/storage.service");
    expect(await headObject(data.stagingKey)).not.toBeNull();
  }, 60_000);
});

describe("[F3.21] presign is rate limited", () => {
  it("allows 10 per hour and returns 429 with Retry-After on the 11th", async (ctx) => {
    if (!available) return ctx.skip();
    signedIn();

    for (let i = 1; i <= 10; i += 1) {
      const res = await post(VALID_BODY);
      expect(res.status, `presign ${i}`).toBe(200);
    }

    const limited = await post(VALID_BODY);

    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(limited.headers.get("X-RateLimit-Limit")).toBe("10");
    expect(limited.headers.get("X-RateLimit-Remaining")).toBe("0");

    const body = (await limited.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RATE_LIMITED");
  }, 120_000);

  it("limits per user, so one publisher cannot block another", async (ctx) => {
    if (!available) return ctx.skip();

    signedIn();
    for (let i = 0; i < 10; i += 1) await post(VALID_BODY);
    expect((await post(VALID_BODY)).status).toBe(429);

    const other = await testDb.user.create({
      data: { email: "other@example.com", githubLogin: "other", role: "USER" },
    });
    signedIn(other.id);

    expect((await post(VALID_BODY)).status).toBe(200);
  }, 120_000);
});
