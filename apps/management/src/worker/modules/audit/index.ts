import { createD1AuditEventPersistence } from "./adapters/d1-audit-events";
import { createAuditEvents } from "./application/audit-events";

export { auditActions, type AuditAction } from "../../../shared/audit";
export type { AuditEvent } from "./application/audit-events";

export function createD1AuditEvents(binding: D1Database) {
  return createAuditEvents(createD1AuditEventPersistence(binding));
}

export type AuditEvents = ReturnType<typeof createD1AuditEvents>;
