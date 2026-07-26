import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const idCheck = (column: { getSQL(): unknown }) => sql`length(${column}) BETWEEN 1 AND 128`;
const timestampCheck = (column: { getSQL(): unknown }) =>
  sql`typeof(${column}) = 'integer' AND ${column} >= 0`;

export const instances = sqliteTable(
  "instances",
  {
    singletonKey: integer("singleton_key").primaryKey(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    setupCompletedAt: integer("setup_completed_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    check(
      "instances_singleton_key_check",
      sql`typeof(${table.singletonKey}) = 'integer'
          AND ${table.singletonKey} = 1`,
    ),
    check("instances_created_at_check", timestampCheck(table.createdAt)),
    check(
      "instances_setup_completed_at_check",
      sql`${table.setupCompletedAt} IS NULL OR (${timestampCheck(table.setupCompletedAt)})`,
    ),
  ],
);

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    displayEmail: text("display_email").notNull(),
    normalizedEmail: text("normalized_email").notNull(),
    state: text("state", { enum: ["invited", "active", "suspended"] }).notNull(),
    role: text("role", { enum: ["administrator", "member", "viewer"] }).notNull(),
    activatedAt: integer("activated_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check("users_id_check", idCheck(table.id)),
    check("users_display_email_check", sql`length(${table.displayEmail}) BETWEEN 3 AND 254`),
    check(
      "users_normalized_email_check",
      sql`length(${table.normalizedEmail}) BETWEEN 3 AND 254
          AND ${table.normalizedEmail} = lower(${table.normalizedEmail})
          AND ${table.normalizedEmail} NOT GLOB '*[^ -~]*'`,
    ),
    check("users_state_check", sql`${table.state} IN ('invited', 'active', 'suspended')`),
    check("users_role_check", sql`${table.role} IN ('administrator', 'member', 'viewer')`),
    check(
      "users_activation_check",
      sql`(${table.state} = 'invited' AND ${table.activatedAt} IS NULL)
          OR (
            ${table.state} IN ('active', 'suspended')
            AND ${table.activatedAt} IS NOT NULL
          )`,
    ),
    check("users_created_at_check", timestampCheck(table.createdAt)),
    check("users_updated_at_check", timestampCheck(table.updatedAt)),
    check("users_timestamp_order_check", sql`${table.updatedAt} >= ${table.createdAt}`),
    uniqueIndex("users_normalized_email_unique").on(table.normalizedEmail),
    index("users_state_role_idx").on(table.state, table.role),
  ],
);

export const credentials = sqliteTable(
  "credentials",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    verifier: text("verifier").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check("credentials_verifier_check", sql`length(${table.verifier}) BETWEEN 1 AND 1024`),
    check("credentials_updated_at_check", timestampCheck(table.updatedAt)),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    csrfToken: text("csrf_token").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
    idleExpiresAt: integer("idle_expires_at", { mode: "timestamp_ms" }).notNull(),
    absoluteExpiresAt: integer("absolute_expires_at", { mode: "timestamp_ms" }).notNull(),
    recentAuthenticationAt: integer("recent_authentication_at", {
      mode: "timestamp_ms",
    }).notNull(),
  },
  (table) => [
    check("sessions_id_check", idCheck(table.id)),
    check("sessions_token_hash_check", sql`length(${table.tokenHash}) = 64`),
    check("sessions_csrf_token_check", sql`length(${table.csrfToken}) BETWEEN 1 AND 128`),
    check("sessions_created_at_check", timestampCheck(table.createdAt)),
    check("sessions_last_seen_at_check", timestampCheck(table.lastSeenAt)),
    check("sessions_idle_expires_at_check", timestampCheck(table.idleExpiresAt)),
    check("sessions_absolute_expires_at_check", timestampCheck(table.absoluteExpiresAt)),
    check("sessions_recent_authentication_at_check", timestampCheck(table.recentAuthenticationAt)),
    check(
      "sessions_time_order_check",
      sql`${table.lastSeenAt} >= ${table.createdAt}
          AND ${table.idleExpiresAt} > ${table.lastSeenAt}
          AND ${table.absoluteExpiresAt} > ${table.createdAt}
          AND ${table.recentAuthenticationAt} >= ${table.createdAt}`,
    ),
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_expiry_idx").on(table.idleExpiresAt, table.absoluteExpiresAt),
  ],
);

export const initialSetup = sqliteTable(
  "initial_setup",
  {
    singletonKey: integer("singleton_key").primaryKey(),
    displayEmail: text("display_email").notNull(),
    normalizedEmail: text("normalized_email").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check(
      "initial_setup_singleton_key_check",
      sql`typeof(${table.singletonKey}) = 'integer' AND ${table.singletonKey} = 1`,
    ),
    check(
      "initial_setup_display_email_check",
      sql`length(${table.displayEmail}) BETWEEN 3 AND 254`,
    ),
    check(
      "initial_setup_normalized_email_check",
      sql`length(${table.normalizedEmail}) BETWEEN 3 AND 254
          AND ${table.normalizedEmail} = lower(${table.normalizedEmail})`,
    ),
    check("initial_setup_token_hash_check", sql`length(${table.tokenHash}) = 64`),
    check("initial_setup_created_at_check", timestampCheck(table.createdAt)),
    check("initial_setup_expires_at_check", timestampCheck(table.expiresAt)),
    check("initial_setup_expiry_order_check", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const invitations = sqliteTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    issuedAt: integer("issued_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check("invitations_id_check", idCheck(table.id)),
    check("invitations_token_hash_check", sql`length(${table.tokenHash}) = 64`),
    check("invitations_issued_at_check", timestampCheck(table.issuedAt)),
    check("invitations_expires_at_check", timestampCheck(table.expiresAt)),
    check("invitations_expiry_order_check", sql`${table.expiresAt} > ${table.issuedAt}`),
    uniqueIndex("invitations_user_id_unique").on(table.userId),
    uniqueIndex("invitations_token_hash_unique").on(table.tokenHash),
  ],
);

export const passwordResets = sqliteTable(
  "password_resets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    issuedAt: integer("issued_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check("password_resets_id_check", idCheck(table.id)),
    check("password_resets_token_hash_check", sql`length(${table.tokenHash}) = 64`),
    check("password_resets_issued_at_check", timestampCheck(table.issuedAt)),
    check("password_resets_expires_at_check", timestampCheck(table.expiresAt)),
    check("password_resets_expiry_order_check", sql`${table.expiresAt} > ${table.issuedAt}`),
    uniqueIndex("password_resets_user_id_unique").on(table.userId),
    uniqueIndex("password_resets_token_hash_unique").on(table.tokenHash),
  ],
);

export const operatorRecovery = sqliteTable(
  "operator_recovery",
  {
    singletonKey: integer("singleton_key").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    tokenHash: text("token_hash").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check(
      "operator_recovery_singleton_key_check",
      sql`typeof(${table.singletonKey}) = 'integer' AND ${table.singletonKey} = 1`,
    ),
    check("operator_recovery_token_hash_check", sql`length(${table.tokenHash}) = 64`),
    check("operator_recovery_created_at_check", timestampCheck(table.createdAt)),
    check("operator_recovery_expires_at_check", timestampCheck(table.expiresAt)),
    check("operator_recovery_expiry_order_check", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

export const links = sqliteTable(
  "links",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    searchTitle: text("search_title").notNull(),
    state: text("state", {
      enum: ["active", "disabled", "archived"],
    }).notNull(),
    revision: integer("revision").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check("links_id_check", idCheck(table.id)),
    check("links_title_check", sql`length(${table.title}) BETWEEN 1 AND 200`),
    check("links_search_title_check", sql`length(${table.searchTitle}) BETWEEN 1 AND 2048`),
    check("links_state_check", sql`${table.state} IN ('active', 'disabled', 'archived')`),
    check(
      "links_revision_check",
      sql`typeof(${table.revision}) = 'integer' AND ${table.revision} >= 0`,
    ),
    check("links_created_at_check", timestampCheck(table.createdAt)),
    check("links_updated_at_check", timestampCheck(table.updatedAt)),
    check("links_timestamp_order_check", sql`${table.updatedAt} >= ${table.createdAt}`),
    index("links_list_order_idx").on(table.updatedAt, table.id),
    index("links_search_title_idx").on(table.searchTitle),
  ],
);

export const aliases = sqliteTable(
  "aliases",
  {
    alias: text("alias").primaryKey(),
    searchAlias: text("search_alias").notNull(),
    linkId: text("link_id").references(() => links.id, {
      onDelete: "restrict",
    }),
    deletedLinkId: text("deleted_link_id"),
    reservedAt: integer("reserved_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    check(
      "aliases_value_check",
      sql`length(${table.alias}) BETWEEN 1 AND 64
          AND ${table.alias} NOT GLOB '*[^A-Za-z0-9_-]*'`,
    ),
    check(
      "aliases_shape_check",
      sql`(
        ${table.linkId} IS NOT NULL
        AND ${table.deletedLinkId} IS NULL
        AND ${table.reservedAt} IS NULL
      ) OR (
        ${table.linkId} IS NULL
        AND ${table.deletedLinkId} IS NOT NULL
        AND ${table.reservedAt} IS NOT NULL
      )`,
    ),
    check("aliases_search_value_check", sql`length(${table.searchAlias}) BETWEEN 1 AND 64`),
    check(
      "aliases_deleted_link_id_check",
      sql`${table.deletedLinkId} IS NULL
          OR length(${table.deletedLinkId}) BETWEEN 1 AND 128`,
    ),
    check(
      "aliases_reserved_at_check",
      sql`${table.reservedAt} IS NULL
          OR (
            typeof(${table.reservedAt}) = 'integer'
            AND ${table.reservedAt} >= 0
          )`,
    ),
    uniqueIndex("aliases_link_id_unique").on(table.linkId),
    index("aliases_search_alias_idx").on(table.searchAlias),
  ],
);

export const destinationVersions = sqliteTable(
  "destination_versions",
  {
    id: text("id").primaryKey(),
    linkId: text("link_id")
      .notNull()
      .references(() => links.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    destination: text("destination").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check("destination_versions_id_check", idCheck(table.id)),
    check(
      "destination_versions_number_check",
      sql`typeof(${table.versionNumber}) = 'integer'
          AND ${table.versionNumber} > 0`,
    ),
    check(
      "destination_versions_destination_check",
      sql`length(${table.destination}) BETWEEN 1 AND 8192`,
    ),
    check("destination_versions_created_at_check", timestampCheck(table.createdAt)),
    uniqueIndex("destination_versions_link_number_unique").on(table.linkId, table.versionNumber),
    index("destination_versions_latest_idx").on(table.linkId, table.versionNumber),
  ],
);

export type AuditMetadata = Readonly<{
  alias?: string;
  fromState?: "active" | "disabled" | "archived";
  toState?: "active" | "disabled" | "archived";
  destinationVersionId?: string;
  fromRole?: "administrator" | "member" | "viewer";
  toRole?: "administrator" | "member" | "viewer";
  fromUserState?: "invited" | "active" | "suspended";
  toUserState?: "invited" | "active" | "suspended";
}>;

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id").notNull(),
    action: text("action", {
      enum: [
        "create",
        "update-destination",
        "update-title",
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
        'update-destination',
        'update-title',
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
        'operator-recovery'
      )`,
    ),
    check("audit_events_subject_id_check", sql`length(${table.subjectId}) BETWEEN 1 AND 128`),
    check("audit_events_occurred_at_check", timestampCheck(table.occurredAt)),
    check(
      "audit_events_metadata_check",
      sql`json_valid(${table.metadata})
          AND length(${table.metadata}) <= 2048`,
    ),
    index("audit_events_occurred_at_idx").on(table.occurredAt),
    index("audit_events_subject_idx").on(table.subjectId, table.occurredAt),
  ],
);
