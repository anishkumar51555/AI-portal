import { AppError } from "./errors";

/**
 * Authorization decisions, as pure functions.
 *
 * Kept in domain/ with zero dependencies so every rule below is unit-testable
 * without a session, a database, or a Next.js runtime. The async wrappers that
 * fetch a session live in src/server/auth/guards.ts and do nothing but call
 * into here.
 *
 * Spec: docs/08-security-model.md section 2.2
 */

export const ROLES = ["USER", "PUBLISHER", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

/** Ordered least→most privileged. Structurally matches the Prisma Role enum. */
const ROLE_RANK: Record<Role, number> = {
  USER: 0,
  PUBLISHER: 1,
  ADMIN: 2,
};

export interface Principal {
  id: string;
  role: Role;
}

/** Roles are hierarchical: an ADMIN satisfies a PUBLISHER requirement. */
export function hasAtLeast(actual: Role, required: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export function assertRole(user: Principal, required: Role): void {
  if (!hasAtLeast(user.role, required)) {
    throw new AppError("FORBIDDEN", undefined, {
      context: { userId: user.id, has: user.role, needs: required },
    });
  }
}

/**
 * May this principal mutate a resource owned by `ownerId`?
 *
 * `ownerId` is null when the resource does not exist.
 *
 * BOTH failure paths return 404, and the "exists but is not yours" case is the
 * deliberate one. A 403 there would confirm the resource exists, turning the
 * endpoint into an enumeration oracle: an attacker could walk slugs and learn
 * exactly which ones are real. 404 leaks nothing and costs nothing.
 */
export function assertCanMutate(user: Principal, ownerId: string | null): void {
  if (ownerId === null) {
    throw new AppError("NOT_FOUND");
  }
  if (ownerId !== user.id && user.role !== "ADMIN") {
    throw new AppError("NOT_FOUND", undefined, {
      // The real reason goes to the log, never to the response.
      context: { reason: "not_owner", userId: user.id, ownerId },
    });
  }
}

/** Non-throwing form, for deciding whether to render an Edit button. */
export function canMutate(user: Principal | null, ownerId: string | null): boolean {
  if (!user || ownerId === null) return false;
  return ownerId === user.id || user.role === "ADMIN";
}
