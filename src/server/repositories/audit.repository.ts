import { prisma } from "@/server/db";

/**
 * Audit log writes.
 *
 * The action vocabulary is CLOSED — docs/02 section 5. Typing it as a union
 * rather than `string` is what stops the log becoming a pile of near-duplicate
 * verbs ("user_login", "USER_SIGNIN", "signed_in") that nobody can query.
 */
export type AuditAction =
  | "USER_SIGNED_IN"
  | "USER_ROLE_CHANGED"
  | "COMPONENT_PUBLISHED"
  | "COMPONENT_VERSION_PUBLISHED"
  | "COMPONENT_UPDATED"
  | "COMPONENT_DELETED"
  | "COMPONENT_SUSPENDED"
  | "UPLOAD_REJECTED"
  | "TEMPLATE_DOWNLOADED";

export interface AuditEvent {
  actorId: string | null;
  action: AuditAction;
  targetType: "User" | "Component" | "Template";
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  /** Already hashed by the caller. A raw IP must never reach this function. */
  ipHash?: string | null;
}

/** Write an audit row. Throws — callers decide whether that is fatal. */
export async function recordAuditEvent(event: AuditEvent): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId: event.actorId,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId ?? null,
      metadata: (event.metadata ?? {}) as never,
      ipHash: event.ipHash ?? null,
    },
  });
}

/**
 * Write an audit row, but never let its failure break the caller.
 *
 * Used on paths where the audit is important but strictly secondary — a sign-in
 * must not fail because the audit table is unavailable. Paths where the audit is
 * part of the transaction (publishing) use `recordAuditEvent` inside the
 * transaction instead, where a failure SHOULD roll everything back.
 */
export async function recordAuditEventSafely(
  event: AuditEvent,
  onError: (err: unknown) => void,
): Promise<void> {
  try {
    await recordAuditEvent(event);
  } catch (err) {
    onError(err);
  }
}
