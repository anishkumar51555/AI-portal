import { describe, it, expect } from "vitest";
import {
  assertCanMutate,
  assertRole,
  canMutate,
  hasAtLeast,
  type Principal,
} from "@/domain/authz";
import { AppError } from "@/domain/errors";

const user = (id: string, role: Principal["role"]): Principal => ({ id, role });

const ALICE = user("usr_alice", "USER");
const PUBLISHER = user("usr_pub", "PUBLISHER");
const ADMIN = user("usr_admin", "ADMIN");

/** Assert a thrown AppError carries the expected code. */
function expectCode(fn: () => void, code: string) {
  try {
    fn();
  } catch (e) {
    expect(AppError.is(e)).toBe(true);
    expect((e as AppError).code).toBe(code);
    return e as AppError;
  }
  throw new Error(`expected ${code} to be thrown, but nothing was`);
}

describe("[F1.2] role hierarchy", () => {
  it("treats roles as ordered, not as a flat set", () => {
    // An ADMIN satisfies a PUBLISHER requirement; the reverse must not hold.
    expect(hasAtLeast("ADMIN", "PUBLISHER")).toBe(true);
    expect(hasAtLeast("ADMIN", "USER")).toBe(true);
    expect(hasAtLeast("PUBLISHER", "USER")).toBe(true);
    expect(hasAtLeast("PUBLISHER", "ADMIN")).toBe(false);
    expect(hasAtLeast("USER", "PUBLISHER")).toBe(false);
    expect(hasAtLeast("USER", "ADMIN")).toBe(false);
  });

  it("is reflexive — every role satisfies itself", () => {
    for (const r of ["USER", "PUBLISHER", "ADMIN"] as const) {
      expect(hasAtLeast(r, r)).toBe(true);
    }
  });

  it("allows a sufficient role through", () => {
    expect(() => assertRole(ADMIN, "PUBLISHER")).not.toThrow();
    expect(() => assertRole(PUBLISHER, "PUBLISHER")).not.toThrow();
  });

  it("rejects an insufficient role with 403 FORBIDDEN", () => {
    const err = expectCode(() => assertRole(ALICE, "ADMIN"), "FORBIDDEN");
    expect(err.status).toBe(403);
  });

  it("does not leak the required role into the response message", () => {
    // "You need ADMIN" tells an attacker the shape of the permission model.
    const err = expectCode(() => assertRole(ALICE, "ADMIN"), "FORBIDDEN");
    expect(err.message).not.toContain("ADMIN");
    // …but the detail IS available to the logs.
    expect(err.context).toMatchObject({ has: "USER", needs: "ADMIN" });
  });
});

describe("[F1.3] ownership — 404, never 403", () => {
  it("allows the owner", () => {
    expect(() => assertCanMutate(ALICE, "usr_alice")).not.toThrow();
  });

  it("allows an ADMIN to act on anyone's resource", () => {
    expect(() => assertCanMutate(ADMIN, "usr_alice")).not.toThrow();
  });

  it("returns 404 when the resource does not exist", () => {
    const err = expectCode(() => assertCanMutate(ALICE, null), "NOT_FOUND");
    expect(err.status).toBe(404);
  });

  it("returns 404 — NOT 403 — for a resource owned by someone else", () => {
    // This is the whole point of the rule. A 403 would confirm the resource
    // exists, letting an attacker enumerate valid slugs by status code alone.
    const err = expectCode(() => assertCanMutate(ALICE, "usr_someone_else"), "NOT_FOUND");
    expect(err.status).toBe(404);
    expect(err.code).not.toBe("FORBIDDEN");
  });

  it("is indistinguishable between 'missing' and 'not yours' from outside", () => {
    // The two failures must be byte-identical to a caller. If they differ in
    // code, status, or message, the oracle is still open.
    let missing: AppError | undefined;
    let notMine: AppError | undefined;
    try {
      assertCanMutate(ALICE, null);
    } catch (e) {
      missing = e as AppError;
    }
    try {
      assertCanMutate(ALICE, "usr_other");
    } catch (e) {
      notMine = e as AppError;
    }

    expect(missing!.code).toBe(notMine!.code);
    expect(missing!.status).toBe(notMine!.status);
    expect(missing!.message).toBe(notMine!.message);
    expect(missing!.details).toBeUndefined();
    expect(notMine!.details).toBeUndefined();
  });

  it("keeps the real reason in context, for logs only", () => {
    const err = expectCode(() => assertCanMutate(ALICE, "usr_other"), "NOT_FOUND");
    expect(err.context).toMatchObject({ reason: "not_owner" });
  });

  it("canMutate mirrors assertCanMutate without throwing", () => {
    expect(canMutate(ALICE, "usr_alice")).toBe(true);
    expect(canMutate(ADMIN, "usr_alice")).toBe(true);
    expect(canMutate(ALICE, "usr_other")).toBe(false);
    expect(canMutate(ALICE, null)).toBe(false);
    expect(canMutate(null, "usr_alice")).toBe(false);
  });

  it("PUBLISHER has no special ownership powers", () => {
    // Only ADMIN overrides ownership. A publisher is not a moderator.
    expect(canMutate(PUBLISHER, "usr_alice")).toBe(false);
    expectCode(() => assertCanMutate(PUBLISHER, "usr_alice"), "NOT_FOUND");
  });
});
