import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { app } from "../../src/worker/index";
import { resetManagementDatabase } from "../support/management-database";
import { loginAdministrator } from "../support/worker-authentication";

const start = "2026-08-01T00:00:00.000Z";
const end = "2026-08-31T00:00:00.000Z";

describe("Administrator Audit Event browsing", () => {
  beforeEach(resetManagementDatabase);

  it("filters and pages retained Audit Events while enriching known identifiers", async () => {
    const administrator = await loginAdministrator();
    const administratorId = await currentAdministratorId();
    await seedAuditEvents(administratorId);

    const first = await app.request(
      auditUrl({ action: "create", limit: "1" }),
      { headers: { cookie: administrator.cookie } },
      env,
    );

    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      items: Array<Record<string, unknown>>;
      nextCursor: string;
    };
    expect(firstBody.items).toEqual([
      {
        id: "audit-create-new",
        occurredAt: "2026-08-09T12:00:00.000Z",
        actor: { id: administratorId, display: "Admin@Example.com" },
        action: "create",
        subject: { id: "link-1", kind: "link", display: "Docs" },
        metadata: { alias: "Docs" },
      },
    ]);
    expect(firstBody.nextCursor).toEqual(expect.any(String));

    const second = await app.request(
      auditUrl({ action: "create", limit: "1", cursor: firstBody.nextCursor }),
      { headers: { cookie: administrator.cookie } },
      env,
    );
    expect(await second.json()).toEqual({
      ok: true,
      items: [
        {
          id: "audit-create-old",
          occurredAt: "2026-08-09T11:00:00.000Z",
          actor: { id: "system", display: "Shortflare system" },
          action: "create",
          subject: { id: "deleted-link", kind: "link", display: null },
          metadata: { alias: "Gone" },
        },
      ],
      nextCursor: null,
    });
  });

  it("rejects invalid ranges and non-Administrator Sessions", async () => {
    const administrator = await loginAdministrator();
    const invalid = await app.request(
      `/api/internal/audit-events?start=${encodeURIComponent(end)}&end=${encodeURIComponent(start)}`,
      { headers: { cookie: administrator.cookie } },
      env,
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ ok: false, kind: "invalid-query", details: {} });

    await env.DB.prepare("UPDATE users SET role = 'member'").run();
    const forbidden = await app.request(
      auditUrl({}),
      { headers: { cookie: administrator.cookie } },
      env,
    );
    expect(forbidden.status).toBe(403);
  });
});

function auditUrl(options: Readonly<{ action?: string; limit?: string; cursor?: string }>) {
  const query = new URLSearchParams({ start, end });
  if (options.action) query.append("action", options.action);
  if (options.limit) query.set("limit", options.limit);
  if (options.cursor) query.set("cursor", options.cursor);
  return `https://management.test/api/internal/audit-events?${query}`;
}

async function currentAdministratorId() {
  const result = await env.DB.prepare(
    "SELECT id FROM users WHERE normalized_email = 'admin@example.com'",
  ).first<{ id: string }>();
  if (!result) throw new Error("Expected the Administrator fixture");
  return result.id;
}

async function seedAuditEvents(administratorId: string) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM audit_events"),
    env.DB.prepare(
      `INSERT INTO links
         (id, title, search_title, state, revision, created_at, updated_at)
       VALUES ('link-1', 'Documentation', 'documentation', 'active', 0, 0, 0)`,
    ),
    env.DB.prepare(
      `INSERT INTO aliases
         (alias, search_alias, link_id, deleted_link_id, reserved_at)
       VALUES ('Docs', 'docs', 'link-1', NULL, NULL)`,
    ),
    auditInsert("audit-create-new", administratorId, "create", "link-1", 1_786_276_800_000, {
      alias: "Docs",
    }),
    auditInsert("audit-create-old", "system", "create", "deleted-link", 1_786_273_200_000, {
      alias: "Gone",
    }),
    auditInsert("audit-role", administratorId, "role-change", administratorId, 1_786_269_600_000, {
      fromRole: "member",
      toRole: "administrator",
    }),
  ]);
}

function auditInsert(
  id: string,
  actorId: string,
  action: string,
  subjectId: string,
  occurredAt: number,
  metadata: object,
) {
  return env.DB.prepare(
    `INSERT INTO audit_events (id, actor_id, action, subject_id, occurred_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(id, actorId, action, subjectId, occurredAt, JSON.stringify(metadata));
}
