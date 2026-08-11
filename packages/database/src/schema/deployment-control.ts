import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { idCheck, timestampCheck } from "./constraints";

export const deploymentMarker = sqliteTable(
  "deployment_marker",
  {
    singletonKey: integer("singleton_key").primaryKey(),
    instanceId: text("instance_id").notNull(),
    installationRelease: text("installation_release").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check(
      "deployment_marker_singleton_key_check",
      sql`typeof(${table.singletonKey}) = 'integer' AND ${table.singletonKey} = 1`,
    ),
    check("deployment_marker_instance_id_check", idCheck(table.instanceId)),
    check(
      "deployment_marker_installation_release_check",
      sql`length(${table.installationRelease}) BETWEEN 1 AND 128`,
    ),
    check("deployment_marker_created_at_check", timestampCheck(table.createdAt)),
  ],
);

export const coherentRelease = sqliteTable(
  "coherent_release",
  {
    singletonKey: integer("singleton_key").primaryKey(),
    release: text("release").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    managementWorkerVersion: text("management_worker_version").notNull(),
    redirectWorkerVersion: text("redirect_worker_version").notNull(),
    // Legacy coherent rows predate artifact identity. The next successful deploy backfills both.
    managementArtifactSha256: text("management_artifact_sha256"),
    redirectArtifactSha256: text("redirect_artifact_sha256"),
    migrationJournalSha256: text("migration_journal_sha256"),
    manifestSha256: text("manifest_sha256").notNull(),
    recordedAt: integer("recorded_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    check(
      "coherent_release_singleton_key_check",
      sql`typeof(${table.singletonKey}) = 'integer' AND ${table.singletonKey} = 1`,
    ),
    check("coherent_release_release_check", sql`length(${table.release}) BETWEEN 1 AND 128`),
    check(
      "coherent_release_schema_version_check",
      sql`typeof(${table.schemaVersion}) = 'integer' AND ${table.schemaVersion} >= 0`,
    ),
    check(
      "coherent_release_management_worker_version_check",
      sql`length(${table.managementWorkerVersion}) BETWEEN 1 AND 256`,
    ),
    check(
      "coherent_release_redirect_worker_version_check",
      sql`length(${table.redirectWorkerVersion}) BETWEEN 1 AND 256`,
    ),
    check(
      "coherent_release_management_artifact_sha256_check",
      digestCheck(table.managementArtifactSha256),
    ),
    check(
      "coherent_release_redirect_artifact_sha256_check",
      digestCheck(table.redirectArtifactSha256),
    ),
    check(
      "coherent_release_migration_journal_sha256_check",
      digestCheck(table.migrationJournalSha256),
    ),
    check("coherent_release_manifest_sha256_check", digestCheck(table.manifestSha256)),
    check("coherent_release_recorded_at_check", timestampCheck(table.recordedAt)),
  ],
);

export const deploymentAttempts = sqliteTable(
  "deployment_attempts",
  {
    id: text("id").primaryKey(),
    planDigest: text("plan_digest").notNull(),
    sourceRelease: text("source_release").notNull(),
    targetRelease: text("target_release").notNull(),
    targetManifestDigest: text("target_manifest_digest").notNull(),
    sourceStateDigest: text("source_state_digest").notNull(),
    targetSchemaVersion: integer("target_schema_version").notNull(),
    targetArtifactDigests: text("target_artifact_digests").notNull(),
    status: text("status", { enum: ["running", "failed", "coherent"] }).notNull(),
    completedActions: text("completed_actions").notNull(),
    stageOutcomes: text("stage_outcomes").notNull(),
    backupBookmark: text("backup_bookmark"),
    backupPath: text("backup_path"),
    backupSha256: text("backup_sha256"),
    recoveryAction: text("recovery_action"),
    failureResource: text("failure_resource"),
    requiredPermission: text("required_permission"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
    failureKind: text("failure_kind"),
    failedStage: text("failed_stage"),
  },
  (table) => [
    check("deployment_attempts_id_check", idCheck(table.id)),
    check("deployment_attempts_plan_digest_check", digestCheck(table.planDigest)),
    check(
      "deployment_attempts_source_release_check",
      sql`length(${table.sourceRelease}) BETWEEN 1 AND 128`,
    ),
    check(
      "deployment_attempts_target_release_check",
      sql`length(${table.targetRelease}) BETWEEN 1 AND 128`,
    ),
    check(
      "deployment_attempts_target_manifest_digest_check",
      digestCheck(table.targetManifestDigest),
    ),
    check("deployment_attempts_source_state_digest_check", digestCheck(table.sourceStateDigest)),
    check(
      "deployment_attempts_target_schema_version_check",
      sql`typeof(${table.targetSchemaVersion}) = 'integer' AND ${table.targetSchemaVersion} >= 0`,
    ),
    check(
      "deployment_attempts_target_artifact_digests_check",
      sql`json_valid(${table.targetArtifactDigests}) AND json_type(${table.targetArtifactDigests}) = 'object'`,
    ),
    check(
      "deployment_attempts_status_check",
      sql`${table.status} IN ('running', 'failed', 'coherent')`,
    ),
    check(
      "deployment_attempts_completed_actions_check",
      sql`json_valid(${table.completedActions}) AND json_type(${table.completedActions}) = 'array'`,
    ),
    check(
      "deployment_attempts_stage_outcomes_check",
      sql`json_valid(${table.stageOutcomes}) AND json_type(${table.stageOutcomes}) = 'array'`,
    ),
    check("deployment_attempts_backup_sha256_check", digestCheck(table.backupSha256)),
    check("deployment_attempts_started_at_check", timestampCheck(table.startedAt)),
    check("deployment_attempts_updated_at_check", timestampCheck(table.updatedAt)),
    check("deployment_attempts_time_order_check", sql`${table.updatedAt} >= ${table.startedAt}`),
    check(
      "deployment_attempts_failure_check",
      sql`(${table.status} = 'failed' AND ${table.failureKind} IS NOT NULL AND ${table.failedStage} IS NOT NULL)
          OR (${table.status} != 'failed' AND ${table.failureKind} IS NULL AND ${table.failedStage} IS NULL)`,
    ),
    index("deployment_attempts_status_idx").on(table.status, table.updatedAt),
  ],
);

export const deploymentLease = sqliteTable(
  "deployment_lease",
  {
    singletonKey: integer("singleton_key").primaryKey(),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => deploymentAttempts.id, { onDelete: "restrict" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    fencingToken: integer("fencing_token").notNull(),
  },
  (table) => [
    check(
      "deployment_lease_singleton_key_check",
      sql`typeof(${table.singletonKey}) = 'integer' AND ${table.singletonKey} = 1`,
    ),
    check("deployment_lease_expires_at_check", timestampCheck(table.expiresAt)),
    check(
      "deployment_lease_fencing_token_check",
      sql`typeof(${table.fencingToken}) = 'integer' AND ${table.fencingToken} > 0`,
    ),
  ],
);

function digestCheck(column: AnySQLiteColumn) {
  return sql`length(${column}) = 64 AND ${column} NOT GLOB '*[^0-9a-f]*'`;
}
