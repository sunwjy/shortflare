import { describe, expect, it } from "vitest";

import { createCloudflareApi } from "../src/cloudflare-api";

describe("Cloudflare REST control-plane adapter", () => {
  it("accepts Queue responses that omit the default delivery-paused setting", async () => {
    const api = createCloudflareApi({
      apiToken: "secret-token",
      fetch: async () =>
        Response.json({
          success: true,
          errors: [],
          messages: [],
          result: {
            queue_id: "queue-1",
            queue_name: "shortflare-events",
            settings: { delivery_delay: 0, message_retention_period: 86_400 },
          },
        }),
    });

    await expect(api.createQueue("account-1", "shortflare-events", 86_400)).resolves.toEqual({
      ok: true,
      queue: {
        id: "queue-1",
        name: "shortflare-events",
        settings: { deliveryDelay: 0, deliveryPaused: false, messageRetentionPeriod: 86_400 },
        producers: [],
        consumers: [],
      },
    });
  });

  it("normalizes the live Queue consumer script field", async () => {
    const api = createCloudflareApi({
      apiToken: "secret-token",
      fetch: async () =>
        Response.json({
          success: true,
          errors: null,
          result: [
            {
              queue_id: "queue-1",
              queue_name: "shortflare-events",
              settings: { delivery_delay: 0, message_retention_period: 86_400 },
              consumers: [
                {
                  consumer_id: "consumer-1",
                  script: "shortflare-management",
                  type: "worker",
                  dead_letter_queue: "shortflare-events-dlq",
                  settings: { batch_size: 10, max_wait_time_ms: 1_000 },
                },
              ],
            },
          ],
        }),
    });

    await expect(api.listQueues("account-1")).resolves.toMatchObject({
      ok: true,
      queues: [{ consumers: [{ scriptName: "shortflare-management" }] }],
    });
  });

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

  it("preflights exact DNS, every Pages page, and Worker route hostname attachments", async () => {
    const requestedUrls: string[] = [];
    const api = createCloudflareApi({
      apiToken: "secret-token",
      fetch: async (input) => {
        requestedUrls.push(String(input));
        const pathname = new URL(String(input)).pathname;
        const url = new URL(String(input));
        const result =
          pathname === "/client/v4/zones"
            ? [{ id: "zone-1", name: "example.com" }]
            : pathname.endsWith("/dns_records")
              ? [{ name: "go.example.com", type: "CNAME" }]
              : pathname.endsWith("/workers/routes")
                ? [{ pattern: "go.example.com/*", script: "foreign-worker" }]
                : url.searchParams.get("page") === "1"
                  ? Array.from({ length: 10 }, (_, index) => ({
                      name: `unrelated-pages-${index}`,
                      domains: [`unrelated-${index}.example.com`],
                    }))
                  : [{ name: "foreign-pages", domains: ["go.example.com"] }];
        return Response.json({ success: true, errors: [], messages: [], result });
      },
    });

    await expect(api.inspectHostnameAttachments?.("account-1", "go.example.com")).resolves.toEqual({
      ok: true,
      attachments: [
        { kind: "dns", owner: "CNAME" },
        { kind: "route", owner: "foreign-worker" },
        { kind: "pages", owner: "foreign-pages" },
      ],
    });
    expect(requestedUrls).toContain(
      "https://api.cloudflare.com/client/v4/accounts/account-1/pages/projects?per_page=10&page=1",
    );
    expect(requestedUrls).toContain(
      "https://api.cloudflare.com/client/v4/accounts/account-1/pages/projects?per_page=10&page=2",
    );
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
          producers: [],
          consumers: [],
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

  it("starts and polls a portable D1 export", async () => {
    const bodies: unknown[] = [];
    const api = createCloudflareApi({
      apiToken: "secret-token",
      fetch: async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return Response.json({
          success: true,
          errors: [],
          messages: [],
          result:
            bodies.length === 1
              ? { at_bookmark: "bookmark-1" }
              : { signed_url: "https://backup.example/export.sql", filename: "export.sql" },
        });
      },
    });

    await expect(api.beginD1Export("account-1", "database-1")).resolves.toEqual({
      ok: true,
      bookmark: "bookmark-1",
    });
    await expect(api.pollD1Export("account-1", "database-1", "bookmark-1")).resolves.toEqual({
      ok: true,
      state: "ready",
      downloadUrl: "https://backup.example/export.sql",
    });
    expect(bodies).toEqual([{ output_format: "polling" }, { current_bookmark: "bookmark-1" }]);
  });

  it("discovers Workers addresses, domains, and secret names without values", async () => {
    const api = createCloudflareApi({
      apiToken: "secret-token",
      fetch: async (input, init) => {
        const pathname = new URL(String(input)).pathname;
        const result =
          init?.method === "PUT"
            ? { id: "domain-1", hostname: "go.example.com", service: "shortflare-redirect" }
            : pathname.endsWith("/workers/subdomain")
              ? { subdomain: "owner" }
              : pathname.endsWith("/workers/domains")
                ? [{ id: "domain-1", hostname: "go.example.com", service: "shortflare-redirect" }]
                : [{ name: "ANALYTICS_HMAC_KEY", type: "secret_text" }];
        return Response.json({ success: true, errors: [], messages: [], result });
      },
    });

    await expect(api.getWorkersSubdomain("account-1")).resolves.toEqual({
      ok: true,
      registered: true,
      subdomain: "owner",
    });
    await expect(api.listWorkerDomains("account-1")).resolves.toEqual({
      ok: true,
      domains: [{ id: "domain-1", hostname: "go.example.com", worker: "shortflare-redirect" }],
    });
    await expect(api.listWorkerSecretNames("account-1", "shortflare-redirect")).resolves.toEqual({
      ok: true,
      names: ["ANALYTICS_HMAC_KEY"],
    });
    await expect(
      api.attachWorkerDomain("account-1", "go.example.com", "shortflare-redirect"),
    ).resolves.toEqual({
      ok: true,
      domain: { id: "domain-1", hostname: "go.example.com", worker: "shortflare-redirect" },
    });
  });

  it("lists Worker scripts and deletes an exact custom-domain resource", async () => {
    const requests: Array<{ pathname: string; method: string }> = [];
    const api = createCloudflareApi({
      apiToken: "secret-token",
      fetch: async (input, init) => {
        const pathname = new URL(String(input)).pathname;
        requests.push({ pathname, method: init?.method ?? "GET" });
        return Response.json({
          success: true,
          errors: [],
          messages: [],
          result: init?.method === "DELETE" ? null : [{ id: "shortflare-management" }],
        });
      },
    });

    await expect(api.listWorkerScripts("account-1")).resolves.toEqual({
      ok: true,
      scripts: [{ name: "shortflare-management" }],
    });
    await expect(api.deleteWorkerDomain("account-1", "domain-1")).resolves.toEqual({
      ok: true,
    });
    await expect(api.deleteQueueConsumer("account-1", "queue-1", "consumer-1")).resolves.toEqual({
      ok: true,
    });
    expect(requests).toEqual([
      { pathname: "/client/v4/accounts/account-1/workers/scripts", method: "GET" },
      { pathname: "/client/v4/accounts/account-1/workers/domains/domain-1", method: "DELETE" },
      {
        pathname: "/client/v4/accounts/account-1/queues/queue-1/consumers/consumer-1",
        method: "DELETE",
      },
    ]);
  });

  it("reads active Worker versions and resource bindings", async () => {
    const api = createCloudflareApi({
      apiToken: "secret-token",
      fetch: async (input) => {
        const pathname = new URL(String(input)).pathname;
        const result = pathname.endsWith("/deployments")
          ? { deployments: [{ versions: [{ percentage: 100, version_id: "version-1" }] }] }
          : [
              { name: "DB", type: "d1", database_id: "database-1" },
              { name: "ANALYTICS_QUEUE", type: "queue", queue_name: "shortflare-events" },
            ];
        return Response.json({ success: true, errors: [], messages: [], result });
      },
    });

    await expect(api.listWorkerBindings("account-1", "shortflare-redirect")).resolves.toEqual({
      ok: true,
      bindings: [
        { name: "DB", type: "d1", databaseId: "database-1" },
        { name: "ANALYTICS_QUEUE", type: "queue", queueName: "shortflare-events" },
      ],
    });
    await expect(api.listActiveWorkerVersions("account-1", "shortflare-redirect")).resolves.toEqual(
      { ok: true, versionIds: ["version-1"] },
    );
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
      resource: "/accounts/account-1/d1/database?name=shortflare",
      requiredPermission: "Account D1 Read",
    });
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });
});
