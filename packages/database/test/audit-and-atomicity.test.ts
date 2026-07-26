import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { createLinks } from "@shortflare/links";
import { createD1LinksPersistence } from "../src/index";
import { resetDatabase } from "./reset-database";

const actor = { id: "user-1" };
const occurredAt = new Date("2026-07-23T00:00:00.000Z");

beforeEach(resetDatabase);

describe("D1 Link mutation persistence", () => {
  it("audits only successful changes with non-sensitive metadata", async () => {
    const links = createTestLinks();
    const created = await links.execute(
      {
        kind: "create",
        alias: "Docs",
        destination: "https://secret.example/path",
        title: "Private title",
      },
      actor,
    );
    if (!created.ok || created.kind !== "link") {
      throw new Error("expected Link creation to succeed");
    }

    await links.execute(
      {
        kind: "update-title",
        linkId: created.link.id,
        title: "Private title",
      },
      actor,
    );
    await links.execute({ kind: "permanently-delete", linkId: created.link.id }, actor);
    await links.execute(
      {
        kind: "update-destination",
        linkId: created.link.id,
        destination: "https://another-secret.example/path",
      },
      actor,
    );
    await links.execute({ kind: "archive", linkId: created.link.id }, actor);
    await links.execute({ kind: "permanently-delete", linkId: created.link.id }, actor);
    await links.execute({ kind: "release-alias", alias: "Docs" }, actor);

    const result = await env.DB.prepare(
      `SELECT
         action,
         actor_id AS actorId,
         subject_id AS subjectId,
         occurred_at AS occurredAt,
         metadata
       FROM audit_events
       ORDER BY rowid`,
    ).all<{
      action: string;
      actorId: string;
      subjectId: string;
      occurredAt: number;
      metadata: string;
    }>();

    expect(
      result.results.map((event) => ({
        ...event,
        metadata: JSON.parse(event.metadata),
      })),
    ).toEqual([
      {
        action: "create",
        actorId: "user-1",
        subjectId: "id-1",
        occurredAt: occurredAt.getTime(),
        metadata: { alias: "Docs" },
      },
      {
        action: "update-destination",
        actorId: "user-1",
        subjectId: "id-1",
        occurredAt: occurredAt.getTime(),
        metadata: { destinationVersionId: "id-3" },
      },
      {
        action: "archive",
        actorId: "user-1",
        subjectId: "id-1",
        occurredAt: occurredAt.getTime(),
        metadata: { fromState: "active", toState: "archived" },
      },
      {
        action: "permanently-delete",
        actorId: "user-1",
        subjectId: "id-1",
        occurredAt: occurredAt.getTime(),
        metadata: { alias: "Docs" },
      },
      {
        action: "release-alias",
        actorId: "user-1",
        subjectId: "id-1",
        occurredAt: occurredAt.getTime(),
        metadata: { alias: "Docs" },
      },
    ]);
    expect(JSON.stringify(result.results)).not.toContain("Private title");
    expect(JSON.stringify(result.results)).not.toContain("secret.example");
  });

  it("rolls back an entire Link creation when its Audit Event fails", async () => {
    await env.DB.prepare(
      `INSERT INTO audit_events
         (id, actor_id, action, subject_id, occurred_at, metadata)
       VALUES ('duplicate-audit-id', 'user-1', 'create', 'existing', 0, '{}')`,
    ).run();
    const links = createTestLinks(() => "duplicate-audit-id");

    await expect(
      links.execute(
        {
          kind: "create",
          alias: "Docs",
          destination: "https://example.com",
          title: "Documentation",
        },
        actor,
      ),
    ).rejects.toThrow();

    await expect(links.resolve("Docs")).resolves.toEqual({
      kind: "not-found",
    });
    const counts = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM links) AS links,
         (SELECT COUNT(*) FROM aliases) AS aliases,
         (SELECT COUNT(*) FROM destination_versions) AS destinationVersions`,
    ).first<{
      links: number;
      aliases: number;
      destinationVersions: number;
    }>();
    expect(counts).toEqual({
      links: 0,
      aliases: 0,
      destinationVersions: 0,
    });
  });

  it("rolls back a Link update when its Audit Event fails", async () => {
    const auditIds = ["create-audit", "duplicate-update-audit"];
    const links = createTestLinks(() => auditIds.shift() ?? "unexpected-audit");
    const created = await links.execute(
      {
        kind: "create",
        alias: "Docs",
        destination: "https://example.com",
        title: "Original title",
      },
      actor,
    );
    if (!created.ok || created.kind !== "link") {
      throw new Error("expected Link creation to succeed");
    }
    await env.DB.prepare(
      `INSERT INTO audit_events
         (id, actor_id, action, subject_id, occurred_at, metadata)
       VALUES (
         'duplicate-update-audit',
         'user-1',
         'update-title',
         'existing',
         0,
         '{}'
       )`,
    ).run();

    await expect(
      links.execute(
        {
          kind: "update-title",
          linkId: created.link.id,
          title: "Changed title",
        },
        actor,
      ),
    ).rejects.toThrow();

    await expect(
      links.query({ kind: "detail", linkId: created.link.id }, actor),
    ).resolves.toMatchObject({
      ok: true,
      kind: "detail",
      link: { title: "Original title" },
    });
  });
});

function createTestLinks(
  generateAuditId: () => string = (() => {
    let auditId = 0;
    return () => `audit-${++auditId}`;
  })(),
) {
  let id = 0;
  return createLinks({
    persistence: createD1LinksPersistence(env.DB, { generateAuditId }),
    redirectDomain: "go.example.com",
    generateId: () => `id-${++id}`,
    now: () => occurredAt,
  });
}
