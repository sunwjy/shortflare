import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("previous-release D1 upgrade", () => {
  it("preserves legacy deployment history while adding detailed attempt identity", async () => {
    const migrations = env.TEST_MIGRATIONS.slice(-3);
    expect(migrations.map((migration) => migration.name)).toEqual([
      "0007_colossal_spitfire.sql",
      "0008_uneven_war_machine.sql",
      "0009_famous_leo.sql",
    ]);
    await env.UPGRADE_DB.prepare(
      `INSERT INTO audit_events
         (id, actor_id, action, subject_id, occurred_at, metadata)
       VALUES ('audit-before-upgrade', 'system', 'create', 'link-before-upgrade', 0, '{}')`,
    ).run();
    await env.UPGRADE_DB.prepare(
      `INSERT INTO coherent_release
         (singleton_key, release, schema_version, management_worker_version,
          redirect_worker_version, manifest_sha256, recorded_at)
       VALUES (1, '0.1.0', 5, 'management-v1', 'redirect-v1', ?, 0)`,
    )
      .bind("a".repeat(64))
      .run();
    await env.UPGRADE_DB.prepare(
      `INSERT INTO deployment_attempts
         (id, plan_digest, source_release, target_release, status,
          completed_actions, started_at, updated_at)
       VALUES ('attempt-legacy', ?, '0.1.0', '0.2.0', 'running', '[0]', 0, 0)`,
    )
      .bind("b".repeat(64))
      .run();

    await applyD1Migrations(env.UPGRADE_DB, migrations);

    const rows = await env.UPGRADE_DB.prepare("SELECT id FROM audit_events").all<{ id: string }>();
    expect(rows.results).toEqual([{ id: "audit-before-upgrade" }]);
    const coherent = await env.UPGRADE_DB.prepare(
      `SELECT release, management_artifact_sha256 AS managementArtifactSha256,
              redirect_artifact_sha256 AS redirectArtifactSha256,
              migration_journal_sha256 AS migrationJournalSha256
       FROM coherent_release WHERE singleton_key = 1`,
    ).first<{
      release: string;
      managementArtifactSha256: string | null;
      redirectArtifactSha256: string | null;
      migrationJournalSha256: string | null;
    }>();
    expect(coherent).toEqual({
      release: "0.1.0",
      managementArtifactSha256: null,
      redirectArtifactSha256: null,
      migrationJournalSha256: null,
    });
    const attempt = await env.UPGRADE_DB.prepare(
      `SELECT target_manifest_digest AS targetManifestDigest,
              source_state_digest AS sourceStateDigest,
              target_schema_version AS targetSchemaVersion,
              target_artifact_digests AS targetArtifactDigests,
              stage_outcomes AS stageOutcomes,
              failure_resource AS failureResource,
              required_permission AS requiredPermission
       FROM deployment_attempts WHERE id = 'attempt-legacy'`,
    ).first();
    expect(attempt).toEqual({
      targetManifestDigest: "0".repeat(64),
      sourceStateDigest: "0".repeat(64),
      targetSchemaVersion: 0,
      targetArtifactDigests: "{}",
      stageOutcomes: "[]",
      failureResource: null,
      requiredPermission: null,
    });
  });
});
