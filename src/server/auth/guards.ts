import { auth } from "./config";
import { prisma } from "@/server/db";
import { AppError } from "@/domain/errors";
import { assertCanMutate, assertRole, type Principal, type Role } from "@/domain/authz";

/**
 * The authorization guards. Every protected Route Handler, Server Action, and
 * Server Component calls one of these on its FIRST line.
 *
 * Middleware is not a substitute. It checks cookie *presence* to redirect; a
 * direct fetch bypasses the page entirely. Conflating the two is the most common
 * Next.js App Router vulnerability (docs/08 section 2.3).
 *
 * Features: F1.1, F1.2, F1.3, F1.4
 */

export interface SessionUser extends Principal {
  name: string | null;
  email: string | null;
  image: string | null;
  githubLogin: string | null;
}

/** The session, or null. Never throws — for optional-auth paths like the catalog. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  return {
    id: session.user.id,
    role: session.user.role,
    name: session.user.name ?? null,
    email: session.user.email ?? null,
    image: session.user.image ?? null,
    githubLogin: session.user.githubLogin ?? null,
  };
}

/** [F1.1] Requires any authenticated user. */
export async function requireAuth(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AppError("UNAUTHENTICATED");
  return user;
}

/**
 * [F1.2] Requires at least `role`. Roles are hierarchical, so ADMIN satisfies
 * a PUBLISHER requirement.
 *
 * Reads the role from the JWT — fine for gating a read or a normal write.
 * For destructive admin operations use `requireFreshRole` instead.
 */
export async function requireRole(role: Role): Promise<SessionUser> {
  const user = await requireAuth();
  assertRole(user, role);
  return user;
}

/**
 * [F1.4] Like requireRole, but re-reads the role from the database.
 *
 * A JWT minted before a demotion stays valid until it expires — up to 24 hours.
 * For reads that window is acceptable; for "suspend this component" or
 * "delete this user" it is not. Costs one indexed lookup on a rare path.
 */
export async function requireFreshRole(role: Role): Promise<SessionUser> {
  const user = await requireAuth();

  const current = await prisma.user.findUnique({
    where: { id: user.id },
    select: { role: true },
  });
  if (!current) throw new AppError("UNAUTHENTICATED");

  const verified: SessionUser = { ...user, role: current.role };
  assertRole(verified, role);
  return verified;
}

/**
 * [F1.3] Requires that the caller owns the resource, or is an ADMIN.
 *
 * `findOwnerId` returns null when the resource does not exist. Both the
 * missing case and the not-yours case produce 404 — see assertCanMutate for
 * why that is deliberate rather than sloppy.
 */
export async function requireOwnership(
  findOwnerId: () => Promise<string | null>,
): Promise<SessionUser> {
  const user = await requireAuth();
  const ownerId = await findOwnerId();
  assertCanMutate(user, ownerId);
  return user;
}
