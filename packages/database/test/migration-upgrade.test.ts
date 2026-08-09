import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("previous-release D1 upgrade", () => {
  it("preserves business data while adding Deployment Control", async () => {
    const migration = env.TEST_MIGRATIONS.at(-1);
    expect(migration?.name).toBe("0005_deployment_control.sql");
    await env.UPGRADE_DB.prepare(
      `INSERT INTO audit_events
         (id, actor_id, action, subject_id, occurred_at, metadata)
       VALUES ('audit-before-upgrade', 'system', 'create', 'link-before-upgrade', 0, '{}')`,
    ).run();

    await applyD1Migrations(env.UPGRADE_DB, migration === undefined ? [] : [migration]);

    const rows = await env.UPGRADE_DB.prepare("SELECT id FROM audit_events").all<{ id: string }>();
    expect(rows.results).toEqual([{ id: "audit-before-upgrade" }]);
    const tables = await env.UPGRADE_DB.prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name LIKE 'deployment_%'
       ORDER BY name`,
    ).all<{ name: string }>();
    expect(tables.results.map(({ name }) => name)).toEqual([
      "deployment_attempts",
      "deployment_lease",
      "deployment_marker",
    ]);
  });
});
