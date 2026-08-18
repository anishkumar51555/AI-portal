import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { encode } from "@auth/core/jwt";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Mint a signed session cookie for the authed E2E journeys.
 *
 * Deliberately NOT driving GitHub's real login screen: that is slow,
 * rate-limited, needs credentials in CI, and tests GitHub rather than this
 * application (docs/11 §4). Instead we create a real user row and forge a real
 * Auth.js JWT with the real secret — every guard downstream then runs exactly
 * as it does in production. The only thing skipped is the OAuth handshake.
 *
 * The secret is read from the environment, never hard-coded. Run the suite via
 * `npm run test:e2e`, which loads `.env.local` for exactly this reason.
 */

export const STORAGE_STATE = join(process.cwd(), "tests", "e2e", ".auth", "state.json");

/** Auth.js names the cookie differently over HTTPS, and salts the JWE with it. */
const COOKIE_NAME = "authjs.session-token";

export default async function globalSetup() {
  const secret = process.env.AUTH_SECRET;
  const databaseUrl = process.env.DATABASE_URL;

  if (!secret || !databaseUrl) {
    throw new Error(
      "E2E needs AUTH_SECRET and DATABASE_URL. Run `npm run test:e2e`, which loads .env.local.",
    );
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl, max: 2 }),
  });

  // A dedicated account, upserted so the suite is re-runnable. PUBLISHER
  // because the publish journey needs to be allowed to publish.
  const user = await prisma.user.upsert({
    where: { email: "e2e@ai-portal.local" },
    update: { role: "PUBLISHER" },
    create: {
      email: "e2e@ai-portal.local",
      name: "E2E Runner",
      githubLogin: "e2e-runner",
      role: "PUBLISHER",
    },
  });
  await prisma.$disconnect();

  // The shape src/server/auth/config.ts puts in the token.
  const token = await encode({
    token: {
      sub: user.id,
      id: user.id,
      role: user.role,
      name: user.name,
      email: user.email,
      githubLogin: user.githubLogin,
    },
    secret,
    // The salt MUST equal the cookie name — Auth.js derives the encryption key
    // from both, so a mismatch produces a cookie the app silently ignores.
    salt: COOKIE_NAME,
    maxAge: 60 * 60,
  });

  await mkdir(join(process.cwd(), "tests", "e2e", ".auth"), { recursive: true });
  await writeFile(
    STORAGE_STATE,
    JSON.stringify({
      cookies: [
        {
          name: COOKIE_NAME,
          value: token,
          domain: "localhost",
          path: "/",
          expires: Math.floor(Date.now() / 1000) + 3600,
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    }),
  );
}
