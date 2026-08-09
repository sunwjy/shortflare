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
