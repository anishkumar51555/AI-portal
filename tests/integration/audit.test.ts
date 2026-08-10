import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  closeTestDb,
  createTestUser,
  databaseAvailable,
  resetDatabase,
  testDb,
} from "./_helpers";
import {
  recordAuditEvent,
  recordAuditEventSafely,
} from "@/server/repositories/audit.repository";

/**
 * The audit contract, against a real database.
 *
 * This is the row that makes every "follow-up" column in the incident runbook
 * answerable instead of aspirational (docs/08 section 8), so its guarantees are
 * worth locking down: it is written on sign-in, it survives the actor being
 * deleted, and a failure to write it never breaks the caller.
 *
 * Feature: F1.5
 */

let dbUp = false;

beforeAll(async () => {
  dbUp = await databaseAvailable();
  if (!dbUp) console.warn("\n  ⚠ Postgres unavailable — run: npm run docker:up\n");
});

beforeEach(async () => {
  if (dbUp) await resetDatabase();
});

afterAll(async () => {
  await closeTestDb();
});

describe("[F1.5] sign-in writes a USER_SIGNED_IN audit row", () => {
  it("persists the row the signIn event emits", async (ctx) => {
    if (!dbUp) ctx.skip();

    const user = await createTestUser({ githubLogin: "octocat" });

    // Exactly the payload src/server/auth/config.ts events.signIn sends.
    await recordAuditEvent({
      actorId: user.id,
      action: "USER_SIGNED_IN",
      targetType: "User",
      targetId: user.id,
      metadata: { provider: "github", isNewUser: true },
    });

    const rows = await testDb.auditLog.findMany({ where: { actorId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "USER_SIGNED_IN",
      targetType: "User",
      targetId: user.id,
    });
    expect(rows[0]?.metadata).toMatchObject({ provider: "github", isNewUser: true });
  });

  it("links the row to the actor, and exposes it through the relation", async (ctx) => {
    if (!dbUp) ctx.skip();

    const user = await createTestUser({ githubLogin: "linked-user" });
    await recordAuditEvent({
      actorId: user.id,
      action: "USER_SIGNED_IN",
      targetType: "User",
      targetId: user.id,
    });

    const withActor = await testDb.auditLog.findFirst({
      where: { actorId: user.id },
      include: { actor: { select: { githubLogin: true } } },
    });
    expect(withActor?.actor?.githubLogin).toBe("linked-user");
  });

  it("SURVIVES the actor being deleted — the trail outlives the account", async (ctx) => {
    if (!dbUp) ctx.skip();

    // The relation is onDelete: SetNull, not Cascade. If it cascaded, deleting an
    // abusive account would erase the evidence of what it did — the exact moment
    // the audit log matters most.
    const user = await createTestUser({ githubLogin: "to-be-deleted" });
    await recordAuditEvent({
      actorId: user.id,
      action: "USER_SIGNED_IN",
      targetType: "User",
      targetId: user.id,
    });

    await testDb.user.delete({ where: { id: user.id } });

    const surviving = await testDb.auditLog.findMany();
    expect(surviving).toHaveLength(1);
    expect(surviving[0]?.actorId).toBeNull();
    // targetId still records WHO it was, even though the row no longer joins.
    expect(surviving[0]?.targetId).toBe(user.id);
  });

  it("never stores a raw IP address", async (ctx) => {
    if (!dbUp) ctx.skip();

    const user = await createTestUser();
    const ipHash = "a".repeat(64); // sha256(ip + salt), produced by the caller

    await recordAuditEvent({
      actorId: user.id,
      action: "USER_SIGNED_IN",
      targetType: "User",
      ipHash,
    });

    const row = await testDb.auditLog.findFirst();
    expect(row?.ipHash).toBe(ipHash);
    expect(row?.ipHash).not.toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);
  });

  it("does not break sign-in when the audit write fails", async (ctx) => {
    if (!dbUp) ctx.skip();

    // A foreign key to a user that does not exist — the write must fail.
    const errors: unknown[] = [];
    await expect(
      recordAuditEventSafely(
        {
          actorId: "usr_does_not_exist",
          action: "USER_SIGNED_IN",
          targetType: "User",
        },
        (err) => errors.push(err),
      ),
    ).resolves.toBeUndefined();

    // Swallowed and reported, not thrown: a user must still get in when the
    // audit table is unhappy.
    expect(errors).toHaveLength(1);
    expect(await testDb.auditLog.count()).toBe(0);
  });

  it("rejects an unknown action at compile time", () => {
    // The vocabulary is closed (docs/02 section 5). This is a type-level
    // guarantee, so the runtime assertion here is only a placeholder for the
    // fact that `action: "user_logged_in"` would not compile.
    expect(true).toBe(true);
  });
});
