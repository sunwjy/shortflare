import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("previous-release D1 upgrade", () => {
  it("preserves Audit Events while adding the browsing indexes", async () => {
    const migration = env.TEST_MIGRATIONS.at(-1);
    expect(migration?.name).toBe("0004_acoustic_nocturne.sql");
    await env.UPGRADE_DB.prepare(
      `INSERT INTO audit_events
         (id, actor_id, action, subject_id, occurred_at, metadata)
       VALUES ('audit-before-upgrade', 'system', 'create', 'link-before-upgrade', 0, '{}')`,
    ).run();

    await applyD1Migrations(env.UPGRADE_DB, migration === undefined ? [] : [migration]);

    const rows = await env.UPGRADE_DB.prepare("SELECT id FROM audit_events").all<{ id: string }>();
    expect(rows.results).toEqual([{ id: "audit-before-upgrade" }]);
    const indexes = await env.UPGRADE_DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'audit_events' ORDER BY name",
    ).all<{ name: string }>();
    expect(indexes.results.map(({ name }) => name)).toEqual([
      "audit_events_action_idx",
      "audit_events_actor_idx",
      "audit_events_occurred_at_idx",
      "audit_events_subject_idx",
      "sqlite_autoindex_audit_events_1",
    ]);
  });
});
