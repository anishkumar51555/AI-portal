import type { Role } from "@/domain/authz";
import type { DefaultSession } from "next-auth";

/**
 * Module augmentation so `session.user.role` is typed everywhere.
 *
 * Without this, every authorization check would need a cast — and a cast is
 * exactly where a role check silently becomes a no-op.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      githubLogin: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    role?: Role;
    githubLogin?: string | null;
  }
}

/**
 * Augment "@auth/core/jwt", NOT "next-auth/jwt".
 *
 * `next-auth/jwt` is nothing but `export * from "@auth/core/jwt"`. Declaration
 * merging applies to the module that *declares* the interface, so augmenting the
 * re-export silently does nothing — `token.role` stays `unknown` and every
 * assignment from it becomes an error (or worse, a cast someone adds to shut it
 * up, which is how a role check quietly turns into a no-op).
 */
declare module "@auth/core/jwt" {
  interface JWT {
    role?: Role;
    githubLogin?: string | null;
  }
}
