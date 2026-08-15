import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  testDb,
  databaseAvailable,
  storageAvailable,
  resetDatabase,
  closeTestDb,
} from "./_helpers";

const run = promisify(execFile);

/**
 * The seed must be safely re-runnable.
 *
 * It runs on every fresh clone, in CI, and after `db:reset`. A seed that only
 * works against an empty database is a seed nobody dares run twice — so this
 * test runs it twice and proves nothing moved.
 *
 * Features: F2.13
 * Spec: docs/02-data-model.md §6
 */

let available = false;

/**
 * The seed is invoked WITHOUT the `--env-file-if-exists` flags the npm script
 * uses, and with an explicit environment. Loading .env.local here would point
 * the seed at the developer's own database and write demo rows into it — the
 * test must only ever touch ai_portal_test.
 */
const SEED_ENV = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL,
  NODE_ENV: "development" as const, // demo catalog is skipped in production
};

/**
 * Invoked as `node --import tsx …` rather than `npx tsx …` so no shell is
 * involved: passing args through a shell concatenates rather than escapes them,
 * which Node now warns about.
 */
async function runSeed() {
  return run(process.execPath, ["--import", "tsx", "prisma/seed.ts"], {
    cwd: process.cwd(),
    env: SEED_ENV,
    timeout: 120_000,
  });
}

async function snapshot() {
  const [tags, templates, components, versions] = await Promise.all([
    testDb.tag.count(),
    testDb.template.count(),
    testDb.component.count(),
    testDb.componentVersion.count(),
  ]);

  const versionRows = await testDb.componentVersion.findMany({
    select: {
      id: true,
      version: true,
      checksumSha256: true,
      objectKey: true,
      createdAt: true,
    },
    orderBy: { objectKey: "asc" },
  });

  const templateRows = await testDb.template.findMany({
    select: { type: true, objectKey: true, checksumSha256: true, sizeBytes: true },
    orderBy: { type: "asc" },
  });

  return { counts: { tags, templates, components, versions }, versionRows, templateRows };
}

beforeAll(async () => {
  available = (await databaseAvailable()) && (await storageAvailable());
  if (!available) return;

  // The seed reads templates/.dist/index.json and skips templates when it is
  // absent — which would turn the `templates: 4` assertion below into a
  // confusing failure on a fresh clone or in CI. Building first is cheap
  // (pure filesystem work, no containers) and makes this test self-contained.
  await run(process.execPath, ["--import", "tsx", "scripts/build-templates.mts"], {
    cwd: process.cwd(),
    timeout: 120_000,
  });

  await resetDatabase();
}, 180_000);

afterAll(async () => {
  await closeTestDb();
});

describe("[F2.13] prisma/seed.ts is idempotent", () => {
  it("produces identical row counts and never rewrites a version row", async (ctx) => {
    if (!available) {
      ctx.skip();
      return;
    }

    await runSeed();
    const first = await snapshot();

    // The seed must actually do something, or "identical twice" is vacuous.
    expect(first.counts.tags).toBe(20);
    expect(first.counts.templates).toBe(4);
    expect(first.counts.components).toBe(8);
    expect(first.counts.versions).toBe(8);

    await runSeed();
    const second = await snapshot();

    expect(second.counts).toEqual(first.counts);
    expect(second.templateRows).toEqual(first.templateRows);

    // The strong claim: ComponentVersion is insert-only (non-negotiable #4).
    // Identical ids AND identical createdAt prove the second run did not
    // delete-and-recreate the rows to arrive at the same count.
    expect(second.versionRows).toEqual(first.versionRows);
  }, 180_000);

  it("stores only manifests that satisfy the published spec", async (ctx) => {
    if (!available) {
      ctx.skip();
      return;
    }

    const { manifestSchema } = await import("@/domain/schemas/manifest");
    const { toFieldErrors } = await import("@/domain/errors");

    const rows = await testDb.componentVersion.findMany({
      select: { objectKey: true, manifest: true },
    });
    expect(rows.length).toBeGreaterThan(0);

    // The catalog must never contain a manifest that violates the very
    // specification this product exists to enforce. An earlier seed wrote
    // `manifestVersion` instead of `specVersion` and skipped three required
    // fields; nothing caught it, because nothing validated the seed's output.
    const invalid = rows.flatMap((row) => {
      const parsed = manifestSchema.safeParse(row.manifest);
      return parsed.success
        ? []
        : [`${row.objectKey}: ${toFieldErrors(parsed.error)[0]?.message ?? "invalid"}`];
    });

    expect(invalid).toEqual([]);
  }, 30_000);

  it("gives every seeded version a unique checksum and object key", async (ctx) => {
    if (!available) {
      ctx.skip();
      return;
    }

    const rows = await testDb.componentVersion.findMany({
      select: { checksumSha256: true, objectKey: true },
    });

    // checksumSha256 is globally unique in the schema, so a seed that generated
    // byte-identical demo archives would fail on insert. This asserts the
    // deterministic-but-distinct property directly rather than waiting for a
    // constraint violation to explain it.
    expect(new Set(rows.map((r) => r.checksumSha256)).size).toBe(rows.length);
    expect(new Set(rows.map((r) => r.objectKey)).size).toBe(rows.length);
  }, 30_000);

  it("points every template row at an object that really exists in storage", async (ctx) => {
    if (!available) {
      ctx.skip();
      return;
    }

    const { headObject } = await import("@/server/storage/storage.service");
    const templates = await testDb.template.findMany({
      select: { type: true, objectKey: true, sizeBytes: true, checksumSha256: true },
    });

    expect(templates).toHaveLength(4);

    for (const template of templates) {
      // Non-negotiable #7: a catalog row pointing at a missing object is a
      // user-visible 404 on the download button.
      const head = await headObject(template.objectKey);
      expect(head, `no object at ${template.objectKey}`).not.toBeNull();
      expect(head?.sizeBytes).toBe(template.sizeBytes);
    }
  }, 60_000);
});
