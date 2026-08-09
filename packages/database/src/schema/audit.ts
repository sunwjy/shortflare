import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { idCheck, timestampCheck } from "./constraints";

export type AuditMetadata = Readonly<{
  alias?: string;
  changedFields?: readonly ("title" | "destination")[];
  fromState?: "active" | "disabled" | "archived";
  toState?: "active" | "disabled" | "archived";
  destinationVersionId?: string;
  fromRole?: "administrator" | "member" | "viewer";
  toRole?: "administrator" | "member" | "viewer";
  fromUserState?: "invited" | "active" | "suspended";
  toUserState?: "invited" | "active" | "suspended";
  analyticsDate?: string;
}>;

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id").notNull(),
    action: text("action", {
      enum: [
        "create",
        "edit",
        "update-title",
        "update-destination",
        "activate",
        "disable",
        "archive",
        "restore",
        "permanently-delete",
        "release-alias",
        "initial-administrator-activate",
        "invitation-issue",
        "invitation-reissue",
        "invitation-accept",
        "invitation-cancel",
        "role-change",
        "user-suspend",
        "user-reactivate",
        "password-reset-issue",
        "password-reset-use",
        "password-change",
        "operator-recovery",
        "analytics-erase",
        "analytics-recalculate",
      ],
    }).notNull(),
    subjectId: text("subject_id").notNull(),
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
    metadata: text("metadata", { mode: "json" }).$type<AuditMetadata>().notNull().default({}),
  },
  (table) => [
    check("audit_events_id_check", idCheck(table.id)),
    check("audit_events_actor_id_check", sql`length(${table.actorId}) BETWEEN 1 AND 128`),
    check(
      "audit_events_action_check",
      sql`${table.action} IN (
        'create',
        'edit',
        'update-title',
        'update-destination',
        'activate',
        'disable',
        'archive',
        'restore',
        'permanently-delete',
        'release-alias',
        'initial-administrator-activate',
        'invitation-issue',
        'invitation-reissue',
        'invitation-accept',
        'invitation-cancel',
        'role-change',
        'user-suspend',
        'user-reactivate',
        'password-reset-issue',
        'password-reset-use',
        'password-change',
        'operator-recovery',
        'analytics-erase',
        'analytics-recalculate'
      )`,
    ),
    check("audit_events_subject_id_check", sql`length(${table.subjectId}) BETWEEN 1 AND 128`),
    check("audit_events_occurred_at_check", timestampCheck(table.occurredAt)),
    check(
      "audit_events_metadata_check",
      sql`json_valid(${table.metadata})
          AND length(${table.metadata}) <= 2048`,
    ),
    index("audit_events_occurred_at_idx").on(sql`${table.occurredAt} DESC`, sql`${table.id} ASC`),
    index("audit_events_actor_idx").on(
      table.actorId,
      sql`${table.occurredAt} DESC`,
      sql`${table.id} ASC`,
    ),
    index("audit_events_action_idx").on(
      table.action,
      sql`${table.occurredAt} DESC`,
      sql`${table.id} ASC`,
    ),
    index("audit_events_subject_idx").on(
      table.subjectId,
      sql`${table.occurredAt} DESC`,
      sql`${table.id} ASC`,
    ),
  ],
);
