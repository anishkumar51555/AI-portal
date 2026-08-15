import { createHash } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { ZipArchive } from "archiver";
import type * as ComponentRepositoryModule from "@/server/repositories/component.repository";
import {
  testDb,
  databaseAvailable,
  storageAvailable,
  resetDatabase,
  closeTestDb,
} from "./_helpers";

/**
 * What survives when the publish transaction fails AFTER storage was promoted.
 *
 * This is the ordering rule the whole two-phase design exists to guarantee
 * (non-negotiable #7, docs/01 §5.2), and it is only observable by making the
 * database write fail on purpose — so it lives in its own file, where the
 * repository can be mocked without affecting the happy-path tests.
 *
 * The claim: an ORPHANED OBJECT is acceptable, a DANGLING ROW is not.
 *
 * Spec: docs/01-architecture.md §5.2 · docs/04 Flow 3
 * Features: F3.16
 */

const mockAuth = vi.fn();
vi.mock("@/server/auth/config", () => ({ auth: () => mockAuth() }));

// Fail the transaction while leaving every earlier step — including the
// CopyObject — genuinely executed.
const shouldFailCommit = { value: false };
vi.mock("@/server/repositories/component.repository", async (importOriginal) => {
  const actual = await importOriginal<typeof ComponentRepositoryModule>();
  return {
    ...actual,
    createComponentWithVersion: async (
      ...args: Parameters<typeof actual.createComponentWithVersion>
    ) => {
      if (shouldFailCommit.value) throw new Error("simulated database failure at COMMIT");
      return actual.createComponentWithVersion(...args);
    },
  };
});

const { stagingKey, componentKey } = await import("@/domain/storage-keys");
const { putObject, headObject } = await import("@/server/storage/storage.service");

let available = false;
let userId = "";

const FIXED_DATE = new Date("2026-01-01T00:00:00.000Z");

async function buildArchive() {
  const manifest = {
    specVersion: "1.0",
    name: "pdf-extractor",
    displayName: "PDF Extractor",
    version: "1.0.0",
    description: "Extracts structured text and tables from PDF documents reliably.",
    author: { name: "Test Publisher" },
    license: "MIT",
    keywords: ["pdf"],
    runtime: { language: "typescript" },
    entrypoint: "src/index.ts",
    type: "skill",
    skill: {
      instructions: "SKILL.md",
      triggers: ["When the user asks to extract text from a PDF"],
    },
  };

  const chunks: Buffer[] = [];
  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.on("data", (c: Buffer) => chunks.push(c));
  for (const [name, body] of Object.entries({
    "component.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "README.md": "# PDF Extractor\n",
    "SKILL.md": "# Instructions\n",
    "src/index.ts": "export const run = () => null;\n",
  })) {
    archive.append(body, { name, date: FIXED_DATE });
  }
  await archive.finalize();

  const bytes = Buffer.concat(chunks);
  return { bytes, checksum: createHash("sha256").update(bytes).digest("hex") };
}

beforeAll(async () => {
  available = (await databaseAvailable()) && (await storageAvailable());
}, 60_000);

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  mockAuth.mockReset();
  shouldFailCommit.value = false;
  if (!available) return;

  await resetDatabase();
  const user = await testDb.user.create({
    data: { email: "atomic@example.com", githubLogin: "atomic", role: "USER" },
  });
  userId = user.id;
  mockAuth.mockResolvedValue({
    user: {
      id: userId,
      role: "USER",
      name: "A",
      email: "atomic@example.com",
      image: null,
      githubLogin: "atomic",
    },
  });
});

describe("[F3.16] a failure after CopyObject", () => {
  it("leaves an orphaned object but never a dangling catalog row", async (ctx) => {
    if (!available) return ctx.skip();

    const { bytes } = await buildArchive();
    const key = stagingKey(userId);
    await putObject(key, bytes);

    shouldFailCommit.value = true;

    const { POST } = await import("@/app/api/components/route");
    const res = await POST(
      new Request("http://localhost:3000/api/components", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stagingKey: key }),
      }),
      {},
    );

    // The publisher gets a 500 with a requestId and nothing else — no stack
    // trace, no SQL fragment (non-negotiable #6).
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      error: { code: string; message: string };
      requestId: string;
    };
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.requestId).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain("simulated database failure");

    // THE POINT: no half-written component.
    expect(await testDb.component.count()).toBe(0);
    expect(await testDb.componentVersion.count()).toBe(0);

    // The promoted object survives, unreferenced. That is the deliberate
    // trade: a few orphaned KB nobody sees, rather than a catalog row whose
    // download button 404s.
    const promoted = componentKey("pdf-extractor", "1.0.0");
    expect(await headObject(promoted)).not.toBeNull();
  }, 60_000);

  it("succeeds normally once the failure is removed", async (ctx) => {
    if (!available) return ctx.skip();

    // Proves the previous test failed because of the injected fault and not
    // because the pipeline is broken — otherwise it would pass for the wrong
    // reason forever.
    const { bytes } = await buildArchive();
    const key = stagingKey(userId);
    await putObject(key, bytes);

    shouldFailCommit.value = false;

    const { POST } = await import("@/app/api/components/route");
    const res = await POST(
      new Request("http://localhost:3000/api/components", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stagingKey: key }),
      }),
      {},
    );

    expect(res.status).toBe(201);
    expect(await testDb.component.count()).toBe(1);
  }, 60_000);
});
