import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "@/domain/errors";
import type { Role } from "@/domain/authz";

/**
 * Guard tests.
 *
 * `auth()` is mocked because it is Auth.js's job to produce a session and ours
 * to react to one correctly — testing the library's OAuth flow here would test
 * Auth.js, not this codebase. The authorization DECISIONS these guards delegate
 * to are covered as pure functions in authz.test.ts.
 */

const mockAuth = vi.fn();
const mockFindUnique = vi.fn();

vi.mock("@/server/auth/config", () => ({
  auth: () => mockAuth(),
}));

vi.mock("@/server/db", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => mockFindUnique(...args) },
  },
}));

const { requireAuth, requireRole, requireFreshRole, requireOwnership, getSessionUser } =
  await import("@/server/auth/guards");

function session(role: Role = "USER", id = "usr_1") {
  return {
    user: { id, role, name: "Test", email: "t@example.com", image: null, githubLogin: "t" },
  };
}

async function expectCode(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (e) {
    expect(AppError.is(e)).toBe(true);
    expect((e as AppError).code).toBe(code);
    return e as AppError;
  }
  throw new Error(`expected ${code} to be thrown, but nothing was`);
}

beforeEach(() => {
  mockAuth.mockReset();
  mockFindUnique.mockReset();
});

describe("[F1.1] requireAuth", () => {
  it("returns the session user when signed in", async () => {
    mockAuth.mockResolvedValue(session("PUBLISHER"));
    const user = await requireAuth();
    expect(user.id).toBe("usr_1");
    expect(user.role).toBe("PUBLISHER");
  });

  it("throws 401 UNAUTHENTICATED when there is no session", async () => {
    mockAuth.mockResolvedValue(null);
    const err = await expectCode(() => requireAuth(), "UNAUTHENTICATED");
    expect(err.status).toBe(401);
  });

  it("throws 401 when a session exists but carries no user id", async () => {
    // A malformed/partial session must fail closed, not be treated as valid.
    mockAuth.mockResolvedValue({ user: { name: "ghost" } });
    await expectCode(() => requireAuth(), "UNAUTHENTICATED");
  });

  it("getSessionUser returns null instead of throwing, for optional-auth pages", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await getSessionUser()).toBeNull();
  });
});

describe("[F1.2] requireRole", () => {
  it("allows a sufficient role", async () => {
    mockAuth.mockResolvedValue(session("ADMIN"));
    await expect(requireRole("PUBLISHER")).resolves.toMatchObject({ role: "ADMIN" });
  });

  it("throws 403 for an insufficient role", async () => {
    mockAuth.mockResolvedValue(session("USER"));
    const err = await expectCode(() => requireRole("ADMIN"), "FORBIDDEN");
    expect(err.status).toBe(403);
  });

  it("throws 401 before 403 when unauthenticated", async () => {
    // Order matters: "sign in" is the actionable message, not "forbidden".
    mockAuth.mockResolvedValue(null);
    await expectCode(() => requireRole("ADMIN"), "UNAUTHENTICATED");
  });
});

describe("requireFreshRole re-reads the role from the database", () => {
  it("rejects a stale ADMIN token after a demotion", async () => {
    // The JWT still says ADMIN; the database says USER. A token minted before a
    // demotion stays valid for up to 24h — unacceptable for destructive actions.
    mockAuth.mockResolvedValue(session("ADMIN"));
    mockFindUnique.mockResolvedValue({ role: "USER" });

    await expectCode(() => requireFreshRole("ADMIN"), "FORBIDDEN");
    expect(mockFindUnique).toHaveBeenCalledOnce();
  });

  it("accepts a promotion the token has not caught up with yet", async () => {
    mockAuth.mockResolvedValue(session("USER"));
    mockFindUnique.mockResolvedValue({ role: "ADMIN" });

    await expect(requireFreshRole("ADMIN")).resolves.toMatchObject({ role: "ADMIN" });
  });

  it("throws 401 when the user has been deleted since the token was issued", async () => {
    mockAuth.mockResolvedValue(session("ADMIN"));
    mockFindUnique.mockResolvedValue(null);
    await expectCode(() => requireFreshRole("ADMIN"), "UNAUTHENTICATED");
  });
});

describe("[F1.3] requireOwnership", () => {
  it("allows the owner", async () => {
    mockAuth.mockResolvedValue(session("USER", "usr_owner"));
    await expect(requireOwnership(async () => "usr_owner")).resolves.toMatchObject({
      id: "usr_owner",
    });
  });

  it("allows an ADMIN over someone else's resource", async () => {
    mockAuth.mockResolvedValue(session("ADMIN", "usr_admin"));
    await expect(requireOwnership(async () => "usr_other")).resolves.toBeTruthy();
  });

  it("returns 404 — not 403 — for a resource owned by someone else", async () => {
    mockAuth.mockResolvedValue(session("USER", "usr_a"));
    const err = await expectCode(() => requireOwnership(async () => "usr_b"), "NOT_FOUND");
    expect(err.status).toBe(404);
  });

  it("returns 404 for a resource that does not exist", async () => {
    mockAuth.mockResolvedValue(session("USER", "usr_a"));
    await expectCode(() => requireOwnership(async () => null), "NOT_FOUND");
  });

  it("does not run the ownership lookup when unauthenticated", async () => {
    // Cheapest check first, and it avoids a pointless database round trip on
    // every unauthenticated probe.
    mockAuth.mockResolvedValue(null);
    const lookup = vi.fn(async () => "usr_a");
    await expectCode(() => requireOwnership(lookup), "UNAUTHENTICATED");
    expect(lookup).not.toHaveBeenCalled();
  });
});
