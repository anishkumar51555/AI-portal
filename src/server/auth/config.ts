import NextAuth, { type NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/server/db";
import { recordAuditEventSafely } from "@/server/repositories/audit.repository";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { Role } from "@/domain/authz";

/**
 * Auth.js v5 — GitHub OAuth with role-based access control.
 *
 * Spec: docs/04-sequence-flows.md Flow 1, docs/08-security-model.md section 2
 * ADR:  docs/adr/ADR-004-authentication.md
 *
 * No passwords are stored anywhere in this system. That removes hashing,
 * reset flows, credential stuffing, and breach exposure as concerns entirely —
 * and GitHub identity doubles as verifiable publisher attribution, which is the
 * right idiom for a developer registry.
 */

export const authConfig = {
  adapter: PrismaAdapter(prisma),

  // JWT, not database sessions. A database session costs a SELECT on every
  // request and makes middleware non-edge-compatible. The trade-off: a role
  // change takes effect on the next token refresh, so privileged operations
  // re-read the role from the database (docs/08 section 2.2).
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
    updateAge: 24 * 60 * 60, // refresh the token at most once a day
  },

  trustHost: env.AUTH_TRUST_HOST,

  pages: {
    signIn: "/login",
    error: "/login",
  },

  providers: [
    GitHub({
      clientId: env.AUTH_GITHUB_ID,
      clientSecret: env.AUTH_GITHUB_SECRET,
      // Default scope is enough: public profile and email. Do not request repo
      // access — asking for permissions you do not use is how a sign-in prompt
      // scares away the exact developers you want.
      authorization: { params: { scope: "read:user user:email" } },

      // Map the GitHub profile onto our User shape. `githubLogin` is what makes
      // a component card show real, verifiable provenance rather than a
      // self-declared display name.
      profile(profile) {
        return {
          id: profile.id.toString(),
          name: profile.name ?? profile.login,
          email: profile.email,
          image: profile.avatar_url,
          githubLogin: profile.login,
          role: "USER" satisfies Role,
        };
      },
    }),
  ],

  callbacks: {
    /**
     * Runs on sign-in and on every token refresh. Copying `role` onto the token
     * here is what makes authorization checks free — without it every guard
     * would hit the database.
     */
    async jwt({ token, user, trigger }) {
      // `user` is only populated on the initial sign-in.
      if (user) {
        token.role = user.role ?? "USER";
        token.githubLogin = user.githubLogin ?? null;
      }

      // On an explicit session update, re-read the role so a promotion to
      // PUBLISHER after a first publish is reflected without signing out.
      if (trigger === "update" && token.sub) {
        const fresh = await prisma.user.findUnique({
          where: { id: token.sub },
          select: { role: true, githubLogin: true },
        });
        if (fresh) {
          token.role = fresh.role;
          token.githubLogin = fresh.githubLogin;
        }
      }

      return token;
    },

    async session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      session.user.role = token.role ?? "USER";
      session.user.githubLogin = token.githubLogin ?? null;
      return session;
    },
  },

  events: {
    async signIn({ user, account, isNewUser }) {
      // Goes through the repository, not prisma directly: this file already has
      // to import the client for PrismaAdapter, which makes it the one place
      // where an ad-hoc query could slip past the boundary rule unnoticed.
      await recordAuditEventSafely(
        {
          actorId: user.id ?? null,
          action: "USER_SIGNED_IN",
          targetType: "User",
          targetId: user.id ?? null,
          metadata: {
            provider: account?.provider ?? "unknown",
            isNewUser: Boolean(isNewUser),
          },
        },
        // An audit write must never block a sign-in. Log it and let the user in.
        (err) => logger.error({ err, userId: user.id }, "failed to write USER_SIGNED_IN"),
      );
    },
  },

  logger: {
    error(error) {
      logger.error({ err: error }, "auth error");
    },
    warn(code) {
      logger.warn({ code }, "auth warning");
    },
  },
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
