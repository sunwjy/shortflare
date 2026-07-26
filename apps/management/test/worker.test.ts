import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { app } from "../src/worker/index";

describe("management worker", () => {
  it("reports its internal health", async () => {
    const response = await app.request("http://management.test/api/internal/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("creates a Link through the development-only endpoint", async () => {
    const response = await app.request(
      "http://management.test/api/internal/links",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          alias: "Docs",
          title: "Documentation",
          destination: "https://example.com/guide",
        }),
      },
      env,
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      ok: true,
      kind: "link",
      link: {
        alias: "Docs",
        title: "Documentation",
        state: "active",
      },
    });
  });

  it("reports an Alias collision as a conflict", async () => {
    const request = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        alias: "Taken",
        title: "Documentation",
        destination: "https://example.com/guide",
      }),
    };
    const firstResponse = await app.request(
      "http://management.test/api/internal/links",
      request,
      env,
    );
    expect(firstResponse.status).toBe(201);

    const response = await app.request("http://management.test/api/internal/links", request, env);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      ok: false,
      kind: "alias-in-use",
      alias: "Taken",
    });
  });

  it("rejects a request that does not match the strict transport schema", async () => {
    const response = await app.request(
      "http://management.test/api/internal/links",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          alias: "Docs",
          destination: "https://example.com/guide",
          unexpected: true,
        }),
      },
      env,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      kind: "invalid-request",
    });
  });
});
