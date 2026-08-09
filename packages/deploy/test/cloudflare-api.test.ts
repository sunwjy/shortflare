import { describe, expect, it } from "vitest";

import { createCloudflareApi } from "../src/cloudflare-api";

describe("Cloudflare REST control-plane adapter", () => {
  it("discovers D1 by exact name and validates the API envelope", async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const api = createCloudflareApi({
      apiToken: "secret-token",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push({
          url: request.url,
          authorization: request.headers.get("authorization"),
        });
        return Response.json({
          success: true,
          errors: [],
          messages: [],
          result: [{ uuid: "database-1", name: "shortflare" }],
        });
      },
    });

    await expect(api.listD1Databases("account-1", "shortflare")).resolves.toEqual({
      ok: true,
      databases: [{ id: "database-1", name: "shortflare" }],
    });
    expect(requests).toEqual([
      {
        url: "https://api.cloudflare.com/client/v4/accounts/account-1/d1/database?name=shortflare",
        authorization: "Bearer secret-token",
      },
    ]);
  });

  it("queries D1 with bound parameters", async () => {
    let body: unknown;
    const api = createCloudflareApi({
      apiToken: "secret-token",
      fetch: async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return Response.json({
          success: true,
          errors: [],
          messages: [],
          result: [{ success: true, results: [{ singletonKey: 1 }] }],
        });
      },
    });

    await expect(
      api.queryD1("account-1", "database-1", "SELECT ? AS singletonKey", ["1"]),
    ).resolves.toEqual({ ok: true, rows: [{ singletonKey: 1 }] });
    expect(body).toEqual({ sql: "SELECT ? AS singletonKey", params: ["1"] });
  });

  it("updates an existing nonempty Queue instead of recreating it", async () => {
    let body: unknown;
    const api = createCloudflareApi({
      apiToken: "secret-token",
      fetch: async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return Response.json({
          success: true,
          errors: [],
          messages: [],
          result: {
            queue_id: "queue-1",
            queue_name: "shortflare-events",
            settings: {
              delivery_delay: 5,
              delivery_paused: false,
              message_retention_period: 86_400,
            },
          },
        });
      },
    });

    await expect(
      api.updateQueueRetention(
        "account-1",
        {
          id: "queue-1",
          name: "shortflare-events",
          settings: { deliveryDelay: 5, deliveryPaused: false, messageRetentionPeriod: 3600 },
        },
        86_400,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(body).toEqual({
      queue_name: "shortflare-events",
      settings: {
        delivery_delay: 5,
        delivery_paused: false,
        message_retention_period: 86_400,
      },
    });
  });

  it("returns a stable error without exposing credentials or raw responses", async () => {
    const api = createCloudflareApi({
      apiToken: "secret-token",
      fetch: async () =>
        Response.json(
          { success: false, errors: [{ code: 10_000, message: "authentication error" }] },
          { status: 403 },
        ),
    });

    const result = await api.listD1Databases("account-1", "shortflare");
    expect(result).toEqual({
      ok: false,
      kind: "cloudflare-authorization",
      status: 403,
      retryable: false,
    });
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });
});
