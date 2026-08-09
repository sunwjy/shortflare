import { env } from "cloudflare:workers";
import { createScheduledController } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { worker } from "../../src/worker/index";
import { resetManagementDatabase } from "../support/management-database";

const scheduledTime = Date.parse("2026-08-09T12:17:00.000Z");
const rawBoundary = Date.parse("2026-05-11T12:17:00.000Z");

describe("scheduled Analytics retention", () => {
  beforeEach(async () => {
    await resetManagementDatabase();
    await seedRetentionRows();
  });

  it("uses scheduledTime for exact raw retention and the floored hourly boundary", async () => {
    const controller = createScheduledController({
      cron: "17 * * * *",
      scheduledTime,
    });

    await worker.scheduled(controller, env);

    await expect(ids("analytics_events")).resolves.toEqual(["event-boundary"]);
    await expect(values("analytics_uniques", "half_hour")).resolves.toEqual([
      Date.parse("2026-05-11T12:30:00.000Z"),
    ]);
    await expect(values("analytics_rollups", "bucket", "interval = 'hour'")).resolves.toEqual([
      Date.parse("2026-05-11T12:00:00.000Z"),
    ]);
    await expect(values("analytics_rollups", "bucket", "interval = 'day'")).resolves.toEqual([
      Date.parse("2026-05-10T00:00:00.000Z"),
    ]);
    await expect(ids("audit_events")).resolves.toEqual(["audit-retained"]);
  });
});

async function seedRetentionRows() {
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO links (id, title, search_title, state, revision, created_at, updated_at) VALUES ('link-1', 'Title', 'title', 'active', 0, 0, 0)",
    ),
    env.DB.prepare(
      "INSERT INTO destination_versions (id, link_id, version_number, destination, created_at) VALUES ('destination-1', 'link-1', 1, 'https://example.com', 0)",
    ),
    analyticsEvent("event-expired", rawBoundary - 1),
    analyticsEvent("event-boundary", rawBoundary),
    analyticsUnique(Date.parse("2026-05-11T12:00:00.000Z"), "expired"),
    analyticsUnique(Date.parse("2026-05-11T12:30:00.000Z"), "retained"),
    analyticsRollup("hour", Date.parse("2026-05-11T11:00:00.000Z")),
    analyticsRollup("hour", Date.parse("2026-05-11T12:00:00.000Z")),
    analyticsRollup("day", Date.parse("2026-05-10T00:00:00.000Z")),
    env.DB.prepare(
      "INSERT INTO audit_events (id, actor_id, action, subject_id, occurred_at, metadata) VALUES ('audit-retained', 'system', 'create', 'link-1', 0, '{}')",
    ),
  ]);
}

function analyticsEvent(id: string, occurredAt: number) {
  return env.DB.prepare(
    `INSERT INTO analytics_events
       (id, schema_version, classification_version, link_id, destination_version_id,
        occurred_at, ingested_at, pseudonymous_visitor, bot_classification,
        referrer_domain, country, device_category)
     VALUES (?, 1, 1, 'link-1', 'destination-1', ?, ?, ?, 'human',
             'example.com', 'KR', 'desktop')`,
  ).bind(id, occurredAt, occurredAt, "A".repeat(43));
}

function analyticsUnique(halfHour: number, visitor: string) {
  return env.DB.prepare(
    `INSERT INTO analytics_uniques
       (scope_kind, scope_id, link_id, destination_version_id, half_hour,
        dimension, dimension_value, pseudonymous_visitor)
     VALUES ('link', 'link-1', 'link-1', NULL, ?, 'total', 'all', ?)`,
  ).bind(halfHour, visitor.padEnd(43, "A"));
}

function analyticsRollup(interval: "day" | "hour", bucket: number) {
  return env.DB.prepare(
    `INSERT INTO analytics_rollups
       (scope_kind, scope_id, link_id, destination_version_id, interval, bucket,
        dimension, dimension_value, human_clicks, unique_human_clicks, suspected_bot_clicks)
     VALUES ('link', 'link-1', 'link-1', NULL, ?, ?, 'total', 'all', 1, 1, 0)`,
  ).bind(interval, bucket);
}

async function ids(table: "analytics_events" | "audit_events") {
  const result = await env.DB.prepare(`SELECT id FROM ${table} ORDER BY id`).all<{ id: string }>();
  return result.results.map(({ id }) => id);
}

async function values(
  table: "analytics_rollups" | "analytics_uniques",
  column: "bucket" | "half_hour",
  condition = "1 = 1",
) {
  const result = await env.DB.prepare(
    `SELECT ${column} AS value FROM ${table} WHERE ${condition} ORDER BY ${column}`,
  ).all<{ value: number }>();
  return result.results.map(({ value }) => value);
}
