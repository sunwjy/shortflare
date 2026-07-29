import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { app } from "../../src/worker/index";
import { resetManagementDatabase } from "../support/management-database";
import { authenticatedHeaders, loginAdministrator } from "../support/worker-authentication";

describe("management Reserved Alias routes", () => {
  beforeEach(resetManagementDatabase);

  it("permanently deletes an Archived Link and manages its Reserved Alias", async () => {
    const authentication = await loginAdministrator();
    const createResponse = await app.request(
      "https://management.test/api/internal/links",
      {
        method: "POST",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({
          alias: "Docs",
          title: "Documentation",
          destination: "https://example.com",
        }),
      },
      env,
    );
    const created = (await createResponse.json()) as { link: { id: string } };
    await app.request(
      `https://management.test/api/internal/links/${created.link.id}/archive`,
      {
        method: "POST",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({ expectedRevision: 0 }),
      },
      env,
    );

    const mismatchResponse = await app.request(
      `https://management.test/api/internal/links/${created.link.id}/permanently-delete`,
      {
        method: "POST",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({
          expectedRevision: 1,
          confirmationAlias: "docs",
        }),
      },
      env,
    );
    expect(mismatchResponse.status).toBe(400);
    expect(await mismatchResponse.json()).toEqual({
      ok: false,
      kind: "confirmation-mismatch",
      details: {},
    });

    const deleteResponse = await app.request(
      `https://management.test/api/internal/links/${created.link.id}/permanently-delete`,
      {
        method: "POST",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({
          expectedRevision: 1,
          confirmationAlias: "Docs",
        }),
      },
      env,
    );
    expect(deleteResponse.status).toBe(200);
    expect(await deleteResponse.json()).toEqual({
      ok: true,
      reservedAlias: {
        alias: "Docs",
        shortUrl: "https://short.test/Docs",
        deletedLinkId: created.link.id,
        reservedAt: expect.any(String),
      },
    });

    const listResponse = await app.request(
      "https://management.test/api/internal/reserved-aliases?search=docs",
      { headers: { cookie: authentication.cookie } },
      env,
    );
    expect(await listResponse.json()).toEqual({
      ok: true,
      items: [
        expect.objectContaining({
          alias: "Docs",
          shortUrl: "https://short.test/Docs",
          deletedLinkId: created.link.id,
        }),
      ],
      nextCursor: null,
    });

    const releaseResponse = await app.request(
      "https://management.test/api/internal/reserved-aliases/Docs/release",
      {
        method: "POST",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({ confirmationAlias: "Docs" }),
      },
      env,
    );
    expect(releaseResponse.status).toBe(204);
    expect(await releaseResponse.text()).toBe("");
  });

  it("requires recent authentication before permanent Link deletion", async () => {
    const authentication = await loginAdministrator();
    const createResponse = await app.request(
      "https://management.test/api/internal/links",
      {
        method: "POST",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({
          alias: "Docs",
          title: "Documentation",
          destination: "https://example.com",
        }),
      },
      env,
    );
    const created = (await createResponse.json()) as { link: { id: string } };
    await app.request(
      `https://management.test/api/internal/links/${created.link.id}/archive`,
      {
        method: "POST",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({ expectedRevision: 0 }),
      },
      env,
    );
    const staleAuthentication = Date.now() - 11 * 60 * 1_000;
    await env.DB.prepare("UPDATE sessions SET created_at = ?, recent_authentication_at = ?")
      .bind(staleAuthentication, staleAuthentication)
      .run();

    const response = await app.request(
      `https://management.test/api/internal/links/${created.link.id}/permanently-delete`,
      {
        method: "POST",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({
          expectedRevision: 1,
          confirmationAlias: "Docs",
        }),
      },
      env,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      ok: false,
      kind: "reauthentication-required",
      details: {},
    });
  });
});
