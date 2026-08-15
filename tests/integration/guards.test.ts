import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { testDb, databaseAvailable, resetDatabase, closeTestDb } from "./_helpers";
import { AppError } from "@/domain/errors";

/**
 * The freshness guard, against a real database.
 *
 * This is the one authorization property a unit test genuinely cannot establish:
 * the whole claim is that the guard disbelieves the JWT and asks Postgres. With
 * a mocked Prisma you are asserting that your mock returned what you told it to.
 *
 * Spec: docs/08-security-model.md §2 · rules/50
 * Features: F1.4
 */

const mockAuth = vi.fn();
vi.mock("@/server/auth/config", () => ({ auth: () => mockAuth() }));

let available = false;

beforeAll(async () => {
  available = await databaseAvailable();
}, 60_000);

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  mockAuth.mockReset();
  if (available) await resetDatabase();
});

/** A session asserting `role`, regardless of what the database says. */
function sessionClaiming(id: string, role: "USER" | "PUBLISHER" | "ADMIN") {
  mockAuth.mockResolvedValue({
    user: { id, role, name: "T", email: "t@example.com", image: null, githubLogin: "t" },
  });
}

describe("[F1.4] ADMIN operations re-read the role from the database", () => {
  it("refuses a demoted admin whose JWT still says ADMIN", async (ctx) => {
    if (!available) return ctx.skip();

    const user = await testDb.user.create({
      data: { email: "ex-admin@example.com", githubLogin: "ex-admin", role: "ADMIN" },
    });

    // The realistic attack: the user WAS an admin, was demoted, and still holds
    // a signed token saying otherwise. JWTs are not revocable — that is the
    // entire reason this guard exists.
    await testDb.user.update({ where: { id: user.id }, data: { role: "USER" } });
    sessionClaiming(user.id, "ADMIN");

    const { requireFreshRole } = await import("@/server/auth/guards");
    const err = await requireFreshRole("ADMIN").catch((e: unknown) => e);

    expect(AppError.is(err)).toBe(true);
    expect((err as AppError).code).toBe("FORBIDDEN");
  });

  it("allows a genuine admin", async (ctx) => {
    if (!available) return ctx.skip();

    const user = await testDb.user.create({
      data: { email: "admin@example.com", githubLogin: "real-admin", role: "ADMIN" },
    });
    sessionClaiming(user.id, "ADMIN");

    const { requireFreshRole } = await import("@/server/auth/guards");
    await expect(requireFreshRole("ADMIN")).resolves.toMatchObject({ id: user.id });
  });

  it("honours a PROMOTION the stale token does not know about", async (ctx) => {
    if (!available) return ctx.skip();

    // Freshness has to cut both ways. A user promoted to PUBLISHER mid-session
    // should not be told to sign out and back in before they can publish.
    const user = await testDb.user.create({
      data: { email: "promoted@example.com", githubLogin: "promoted", role: "PUBLISHER" },
    });
    sessionClaiming(user.id, "USER");

    const { requireFreshRole } = await import("@/server/auth/guards");
    await expect(requireFreshRole("PUBLISHER")).resolves.toMatchObject({ id: user.id });
  });

  it("refuses a token for a user that no longer exists", async (ctx) => {
    if (!available) return ctx.skip();

    // A deleted account's token stays cryptographically valid until it expires.
    sessionClaiming("usr_deleted_nonexistent", "ADMIN");

    const { requireFreshRole } = await import("@/server/auth/guards");
    const err = await requireFreshRole("ADMIN").catch((e: unknown) => e);

    expect(AppError.is(err)).toBe(true);
    expect(["FORBIDDEN", "UNAUTHENTICATED"]).toContain((err as AppError).code);
  });
});
