import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { app } from "../../src/worker/index";
import { resetManagementDatabase } from "../support/management-database";
import { authenticatedHeaders, loginAdministrator } from "../support/worker-authentication";

describe("management transport validation", () => {
  beforeEach(resetManagementDatabase);

  it("rejects request integrity failures before validating a mutation", async () => {
    const response = await app.request(
      "https://management.test/api/internal/users/invitations",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.test",
        },
        body: JSON.stringify({ unexpected: true }),
      },
      env,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, kind: "forbidden" });
  });

  it("rejects unauthenticated mutations before validating their body", async () => {
    const response = await app.request(
      "https://management.test/api/internal/users/missing/role",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://management.test",
        },
        body: JSON.stringify({ unexpected: true }),
      },
      env,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, kind: "unauthenticated" });
  });

  it("validates an authorized mutation before requiring recent authentication", async () => {
    const authentication = await loginAdministrator();
    const staleAuthentication = Date.now() - 11 * 60 * 1_000;
    await env.DB.prepare("UPDATE sessions SET created_at = ?, recent_authentication_at = ?")
      .bind(staleAuthentication, staleAuthentication)
      .run();

    const response = await app.request(
      "https://management.test/api/internal/links/missing/permanently-delete",
      {
        method: "POST",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({ unexpected: true }),
      },
      env,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      kind: "invalid-request",
      details: {},
    });
  });

  it("reports an Alias collision as a conflict", async () => {
    const authentication = await loginAdministrator();
    const request = {
      method: "POST",
      headers: authenticatedHeaders(authentication),
      body: JSON.stringify({
        alias: "Taken",
        title: "Documentation",
        destination: "https://example.com/guide",
      }),
    };
    const firstResponse = await app.request(
      "https://management.test/api/internal/links",
      request,
      env,
    );
    expect(firstResponse.status).toBe(201);

    const response = await app.request("https://management.test/api/internal/links", request, env);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      ok: false,
      kind: "alias-in-use",
      details: { alias: "Taken" },
    });
  });

  it("rejects a request that does not match the strict transport schema", async () => {
    const authentication = await loginAdministrator();
    const response = await app.request(
      "https://management.test/api/internal/links",
      {
        method: "POST",
        headers: authenticatedHeaders(authentication),
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
      details: {},
    });
  });

  it("rejects unknown Link query parameters", async () => {
    const authentication = await loginAdministrator();
    const response = await app.request(
      "https://management.test/api/internal/links?stats=archived",
      { headers: { cookie: authentication.cookie } },
      env,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      kind: "invalid-query",
      details: {},
    });
  });

  it("rejects an empty Link edit", async () => {
    const authentication = await loginAdministrator();
    const response = await app.request(
      "https://management.test/api/internal/links/missing",
      {
        method: "PATCH",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({ expectedRevision: 0 }),
      },
      env,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      kind: "invalid-request",
      details: {},
    });
  });
});
