import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("fresh D1 migration", () => {
  it("creates exactly one Instance record", async () => {
    await expect(
      env.DB.prepare("INSERT INTO instances (singleton_key, created_at) VALUES (2, 0)").run(),
    ).rejects.toThrow();

    const instances = await env.DB.prepare(
      "SELECT singleton_key AS singletonKey FROM instances",
    ).all<{ singletonKey: number }>();
    expect(instances.results).toEqual([{ singletonKey: 1 }]);
  });

  it("constrains Deployment Control to one immutable marker and coherent release", async () => {
    await env.DB.prepare(
      `INSERT INTO deployment_marker
         (singleton_key, instance_id, installation_release, created_at)
       VALUES (1, 'instance-1', '1.0.0', 1)`,
    ).run();
    await expect(
      env.DB.prepare(
        `INSERT INTO deployment_marker
           (singleton_key, instance_id, installation_release, created_at)
         VALUES (2, 'instance-2', '1.0.0', 1)`,
      ).run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare("UPDATE deployment_marker SET instance_id = 'instance-2'").run(),
    ).rejects.toThrow();

    await env.DB.prepare(
      `INSERT INTO coherent_release
         (singleton_key, release, schema_version, management_worker_version,
          redirect_worker_version, manifest_sha256, recorded_at)
       VALUES (1, '1.0.0', 5, 'management-v1', 'redirect-v1', ?, 2)`,
    )
      .bind("a".repeat(64))
      .run();
    await expect(
      env.DB.prepare(
        `UPDATE coherent_release SET manifest_sha256 = 'not-a-digest' WHERE singleton_key = 1`,
      ).run(),
    ).rejects.toThrow();
  });

  it("records resumable attempts behind a singleton fenced lease", async () => {
    await env.DB.prepare(
      `INSERT INTO deployment_attempts
         (id, plan_digest, source_release, target_release, status,
          completed_actions, started_at, updated_at)
       VALUES ('attempt-1', ?, 'fresh', '1.0.0', 'running', '[0,1]', 1, 1)`,
    )
      .bind("a".repeat(64))
      .run();
    await env.DB.prepare(
      `INSERT INTO deployment_lease
         (singleton_key, attempt_id, expires_at, fencing_token)
       VALUES (1, 'attempt-1', 1000, 1)`,
    ).run();

    await expect(
      env.DB.prepare(
        `INSERT INTO deployment_lease
           (singleton_key, attempt_id, expires_at, fencing_token)
         VALUES (2, 'attempt-1', 1000, 2)`,
      ).run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare(
        "UPDATE deployment_attempts SET completed_actions = 'not-json' WHERE id = 'attempt-1'",
      ).run(),
    ).rejects.toThrow();
  });

  it("keeps case-distinct Aliases while rejecting invalid characters", async () => {
    await insertLink("link-upper");
    await insertLink("link-lower");

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO aliases
             (alias, search_alias, link_id, deleted_link_id, reserved_at)
           VALUES (?, ?, ?, NULL, NULL)`,
      ).bind("Docs", "docs", "link-upper"),
      env.DB.prepare(
        `INSERT INTO aliases
             (alias, search_alias, link_id, deleted_link_id, reserved_at)
           VALUES (?, ?, ?, NULL, NULL)`,
      ).bind("docs", "docs", "link-lower"),
    ]);

    await expect(
      env.DB.prepare(
        `INSERT INTO aliases
           (alias, search_alias, link_id, deleted_link_id, reserved_at)
         VALUES ('bad/path', 'bad/path', NULL, 'deleted-link', 0)`,
      ).run(),
    ).rejects.toThrow();

    const aliases = await env.DB.prepare(
      "SELECT alias FROM aliases ORDER BY alias COLLATE BINARY",
    ).all<{ alias: string }>();
    expect(aliases.results).toEqual([{ alias: "Docs" }, { alias: "docs" }]);
  });

  it("enforces exclusive assigned and Reserved Alias shapes", async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO aliases
           (alias, search_alias, link_id, deleted_link_id, reserved_at)
         VALUES ('Orphan', 'orphan', NULL, NULL, NULL)`,
      ).run(),
    ).rejects.toThrow();

    await expect(
      env.DB.prepare(
        `INSERT INTO aliases
           (alias, search_alias, link_id, deleted_link_id, reserved_at)
         VALUES ('Reserved', 'reserved', NULL, 'deleted-link', 0)`,
      ).run(),
    ).resolves.toMatchObject({ success: true });
  });

  it("orders Destination Versions with a positive per-Link number", async () => {
    await insertLink("versioned-link");
    await env.DB.prepare(
      `INSERT INTO destination_versions
         (id, link_id, version_number, destination, created_at)
       VALUES ('version-1', 'versioned-link', 1, 'https://example.com/one', 0)`,
    ).run();

    await expect(
      env.DB.prepare(
        `INSERT INTO destination_versions
           (id, link_id, version_number, destination, created_at)
         VALUES ('version-duplicate', 'versioned-link', 1, 'https://example.com/two', 0)`,
      ).run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare(
        `INSERT INTO destination_versions
           (id, link_id, version_number, destination, created_at)
         VALUES ('version-zero', 'versioned-link', 0, 'https://example.com/zero', 0)`,
      ).run(),
    ).rejects.toThrow();
  });

  it("rejects non-integer counters and oversized persisted strings", async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO links
           (id, title, search_title, state, revision, created_at, updated_at)
         VALUES ('fractional', 'Title', 'title', 'active', 1.5, 0, 0)`,
      ).run(),
    ).rejects.toThrow();

    await insertLink("bounded-link");
    await expect(
      env.DB.prepare(
        `INSERT INTO destination_versions
           (id, link_id, version_number, destination, created_at)
         VALUES ('oversized', 'bounded-link', 1, ?, 0)`,
      )
        .bind(`https://example.com/${"x".repeat(8_193)}`)
        .run(),
    ).rejects.toThrow();

    await expect(
      env.DB.prepare(
        `INSERT INTO audit_events
           (id, actor_id, action, subject_id, occurred_at, metadata)
         VALUES ('oversized', 'user-1', 'create', 'link-1', 0, ?)`,
      )
        .bind(JSON.stringify({ value: "x".repeat(2_048) }))
        .run(),
    ).rejects.toThrow();
  });
});

async function insertLink(id: string) {
  await env.DB.prepare(
    `INSERT INTO links
       (id, title, search_title, state, revision, created_at, updated_at)
     VALUES (?, 'Title', 'title', 'active', 0, 0, 0)`,
  )
    .bind(id)
    .run();
}
