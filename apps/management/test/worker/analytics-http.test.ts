import { createAnalytics, type ClickEvent } from "@shortflare/analytics";
import { createD1AnalyticsPersistence, createD1LinksPersistence } from "@shortflare/database";
import { createLinks } from "@shortflare/links";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { app as productionApp, createManagementApp } from "../../src/worker/app";
import { resetManagementDatabase } from "../support/management-database";
import { authenticatedHeaders, loginAdministrator } from "../support/worker-authentication";

const event: ClickEvent = {
  schemaVersion: 1,
  classificationVersion: 1,
  eventId: "analytics-http-event",
  linkId: "ranked-link",
  destinationVersionId: "ranked-destination",
  occurredAt: "2026-08-01T12:14:00.000Z",
  pseudonymousVisitor: "A".repeat(43),
  botClassification: "human",
  referrerDomain: "news.example.com",
  country: "KR",
  deviceCategory: "desktop",
};

describe("Management Analytics HTTP interface", () => {
  beforeEach(resetManagementDatabase);

  it("returns Instance analytics with ranked Link display data", async () => {
    const analytics = createAnalytics({
      persistence: createD1AnalyticsPersistence(env.DB),
      now: () => new Date("2026-08-09T00:00:00.000Z"),
    });
    const links = createLinks({
      persistence: createD1LinksPersistence(env.DB),
      redirectDomain: env.REDIRECT_DOMAIN,
      generateId: (() => {
        const ids = ["ranked-link", "ranked-destination"];
        return () => ids.shift() ?? "unused-id";
      })(),
      now: () => new Date("2026-07-31T00:00:00.000Z"),
    });
    await links.execute(
      {
        kind: "create",
        alias: "Ranked",
        destination: "https://example.com/ranked",
        title: "Ranked Link",
      },
      { id: "administrator" },
    );
    await analytics.ingest([event]);

    const app = createManagementApp({
      createAnalytics: () => analytics,
      createIdentity: () => {
        throw new Error("Analytics reads must not create Identity directly");
      },
      createLinks: () => links,
      createRequestAuthentication: () => ({
        async authenticateSafe() {
          return {
            ok: true,
            user: {
              id: "viewer",
              email: "Viewer@Example.com",
              role: "viewer",
              state: "active",
            },
          };
        },
        async authenticateMutation() {
          throw new Error("Unexpected mutation authentication");
        },
      }),
      createRequestRateLimits: () => ({
        async limit() {
          return true;
        },
      }),
      hasCapability: (_user, capability) => capability === "view-analytics",
    });

    const response = await app.request(
      "https://management.test/api/internal/analytics?start=2026-08-01T00%3A00%3A00.000Z&end=2026-08-02T00%3A00%3A00.000Z&granularity=day&limit=10",
      { headers: { cookie: "__Host-shortflare_session=session" } },
      env,
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).not.toHaveProperty("kind");
    expect(body).toMatchObject({
      ok: true,
      summary: { humanClicks: 1, uniqueHumanClicks: 1, suspectedBotClicks: 0 },
      topLinks: {
        items: [
          {
            id: "ranked-link",
            alias: "Ranked",
            shortUrl: "https://short.test/Ranked",
            title: "Ranked Link",
            state: "active",
            humanClicks: 1,
            uniqueHumanClicks: 1,
          },
        ],
      },
    });
  });

  it("returns zero-filled analytics for an existing Link", async () => {
    const administrator = await loginAdministrator();
    const createResponse = await productionApp.request(
      "https://management.test/api/internal/links",
      {
        method: "POST",
        headers: authenticatedHeaders(administrator),
        body: JSON.stringify({
          alias: "Quiet",
          title: "Quiet Link",
          destination: "https://example.com/quiet",
        }),
      },
      env,
    );
    const createBody = (await createResponse.json()) as { link: { id: string } };

    const response = await productionApp.request(
      `https://management.test/api/internal/links/${createBody.link.id}/analytics?start=2026-08-01T00%3A00%3A00.000Z&end=2026-08-02T00%3A00%3A00.000Z&granularity=day&limit=10`,
      { headers: { cookie: administrator.cookie } },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      summary: { humanClicks: 0, uniqueHumanClicks: 0, suspectedBotClicks: 0 },
      series: [
        {
          bucket: "2026-08-01T00:00:00.000Z",
          humanClicks: 0,
          uniqueHumanClicks: 0,
          suspectedBotClicks: 0,
        },
      ],
    });
  });

  it("rejects unknown Analytics query parameters", async () => {
    const administrator = await loginAdministrator();

    const response = await productionApp.request(
      "https://management.test/api/internal/analytics?start=2026-08-01T00%3A00%3A00.000Z&end=2026-08-02T00%3A00%3A00.000Z&granularity=day&metric=human",
      { headers: { cookie: administrator.cookie } },
      env,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      kind: "invalid-query",
      details: {},
    });
  });
});
