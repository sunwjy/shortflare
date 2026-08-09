import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("previous-release D1 upgrade", () => {
  it("preserves legacy coherent releases while adding artifact identity", async () => {
    const migration = env.TEST_MIGRATIONS.at(-1);
    expect(migration?.name).toBe("0006_wandering_hydra.sql");
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

    await applyD1Migrations(env.UPGRADE_DB, migration === undefined ? [] : [migration]);

    const rows = await env.UPGRADE_DB.prepare("SELECT id FROM audit_events").all<{ id: string }>();
    expect(rows.results).toEqual([{ id: "audit-before-upgrade" }]);
    const coherent = await env.UPGRADE_DB.prepare(
      `SELECT release, management_artifact_sha256 AS managementArtifactSha256,
              redirect_artifact_sha256 AS redirectArtifactSha256
       FROM coherent_release WHERE singleton_key = 1`,
    ).first<{
      release: string;
      managementArtifactSha256: string | null;
      redirectArtifactSha256: string | null;
    }>();
    expect(coherent).toEqual({
      release: "0.1.0",
      managementArtifactSha256: null,
      redirectArtifactSha256: null,
    });
  });
});
