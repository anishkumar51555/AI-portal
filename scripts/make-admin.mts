/**
 * Promote a user to ADMIN.
 *
 *   npx tsx scripts/make-admin.mts you@example.com
 *   npx tsx scripts/make-admin.mts --github your-gh-login
 *
 * Deliberately a script and not a UI: there is no bootstrap path to ADMIN
 * through the application, so an attacker cannot escalate through any request.
 * The first admin is created by someone with shell access to the database, and
 * every promotion is written to the audit log.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadEnv } from "dotenv";

// .env.local first — see the note in prisma.config.ts. Scripts run outside
// Next, so they do not get Next's env loading for free.
loadEnv({ path: [".env.local", ".env"], quiet: true });

const args = process.argv.slice(2);
const byGithub = args.includes("--github");
const identifier = args.find((a) => !a.startsWith("--"));

if (!identifier) {
  console.error(
    "Usage:\n" +
      "  npx tsx scripts/make-admin.mts <email>\n" +
      "  npx tsx scripts/make-admin.mts --github <githubLogin>",
  );
  process.exit(1);
}

const connectionString = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local first.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

try {
  const where = byGithub ? { githubLogin: identifier } : { email: identifier };
  const user = await prisma.user.findUnique({ where });

  if (!user) {
    console.error(
      `No user found for ${byGithub ? "githubLogin" : "email"} "${identifier}".\n` +
        "The user must sign in through GitHub at least once before being promoted.",
    );
    process.exit(1);
  }

  if (user.role === "ADMIN") {
    console.log(`${user.email ?? user.githubLogin} is already an ADMIN. Nothing to do.`);
    process.exit(0);
  }

  const previousRole = user.role;

  // One transaction: the promotion and its audit record are inseparable.
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } }),
    prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: "USER_ROLE_CHANGED",
        targetType: "User",
        targetId: user.id,
        metadata: { from: previousRole, to: "ADMIN", by: "scripts/make-admin.mts" },
      },
    }),
  ]);

  console.log(`Promoted ${user.email ?? user.githubLogin}: ${previousRole} → ADMIN`);
} finally {
  await prisma.$disconnect();
}
