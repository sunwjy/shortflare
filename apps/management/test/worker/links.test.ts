import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { buildSequentialFixtures } from "../../../../test/support/sequential-fixtures";
import { app } from "../../src/worker/index";
import { resetManagementDatabase } from "../support/management-database";
import { authenticatedHeaders, loginAdministrator } from "../support/worker-authentication";

describe("management Link routes", () => {
  beforeEach(resetManagementDatabase);

  it("creates a Link as an authenticated Administrator", async () => {
    const authentication = await loginAdministrator();
    const response = await app.request(
      "https://management.test/api/internal/links",
      {
        method: "POST",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({
          alias: "Docs",
          title: "Documentation",
          destination: "https://example.com/guide",
        }),
      },
      env,
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      ok: true,
      link: {
        id: expect.any(String),
        alias: "Docs",
        shortUrl: "https://short.test/Docs",
        title: "Documentation",
        state: "active",
        revision: 0,
        destination: {
          id: expect.any(String),
          versionNumber: 1,
          url: "https://example.com/guide",
          createdAt: expect.any(String),
        },
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
    });
  });

  it("generates an Alias only when the create request omits it", async () => {
    const authentication = await loginAdministrator();
    const response = await app.request(
      "https://management.test/api/internal/links",
      {
        method: "POST",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({
          title: "Generated",
          destination: "https://example.com/generated",
        }),
      },
      env,
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      link: { alias: string; shortUrl: string };
    };
    expect(body.link.alias).toMatch(/^[0-9A-Za-z]{6}$/);
    expect(body.link.shortUrl).toBe(`https://short.test/${body.link.alias}`);
  });

  it("lists and reads Links through the common transport DTO", async () => {
    const authentication = await loginAdministrator();
    const createResponse = await app.request(
      "https://management.test/api/internal/links",
      {
        method: "POST",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({
          alias: "Docs",
          title: "Documentation",
          destination: "https://example.com/guide",
        }),
      },
      env,
    );
    const created = (await createResponse.json()) as { link: { id: string } };

    const listResponse = await app.request(
      "https://management.test/api/internal/links?search=docs&state=active&limit=10",
      { headers: { cookie: authentication.cookie } },
      env,
    );
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toEqual({
      ok: true,
      items: [
        expect.objectContaining({
          id: created.link.id,
          alias: "Docs",
          shortUrl: "https://short.test/Docs",
          revision: 0,
          destination: expect.objectContaining({
            versionNumber: 1,
            url: "https://example.com/guide",
          }),
        }),
      ],
      nextCursor: null,
    });

    const detailResponse = await app.request(
      `https://management.test/api/internal/links/${created.link.id}`,
      { headers: { cookie: authentication.cookie } },
      env,
    );
    expect(detailResponse.status).toBe(200);
    expect(await detailResponse.json()).toEqual({
      ok: true,
      link: expect.objectContaining({
        id: created.link.id,
        alias: "Docs",
        destination: expect.objectContaining({ versionNumber: 1 }),
      }),
    });
  });

  it("edits a Link atomically and rejects a stale revision", async () => {
    const authentication = await loginAdministrator();
    const createResponse = await app.request(
      "https://management.test/api/internal/links",
      {
        method: "POST",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({
          alias: "Docs",
          title: "Documentation",
          destination: "https://example.com/v1",
        }),
      },
      env,
    );
    const created = (await createResponse.json()) as { link: { id: string } };

    const editResponse = await app.request(
      `https://management.test/api/internal/links/${created.link.id}`,
      {
        method: "PATCH",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({
          expectedRevision: 0,
          title: "Updated documentation",
          destination: "https://example.com/v2",
        }),
      },
      env,
    );
    expect(editResponse.status).toBe(200);
    expect(await editResponse.json()).toEqual({
      ok: true,
      changed: true,
      link: expect.objectContaining({
        revision: 1,
        title: "Updated documentation",
        destination: expect.objectContaining({
          versionNumber: 2,
          url: "https://example.com/v2",
        }),
      }),
    });

    const staleResponse = await app.request(
      `https://management.test/api/internal/links/${created.link.id}`,
      {
        method: "PATCH",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({
          expectedRevision: 0,
          title: "Updated documentation",
        }),
      },
      env,
    );
    expect(staleResponse.status).toBe(409);
    expect(await staleResponse.json()).toEqual({
      ok: false,
      kind: "link-conflict",
      details: { revision: 1 },
    });
  });

  it("executes explicit Link state commands with revision guards", async () => {
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
    const commands = [
      ["disable", 0, "disabled", 1],
      ["archive", 1, "archived", 2],
      ["restore", 2, "disabled", 3],
      ["activate", 3, "active", 4],
    ] as const;

    await buildSequentialFixtures(
      commands,
      async ([command, expectedRevision, state, revision]) => {
        const response = await app.request(
          `https://management.test/api/internal/links/${created.link.id}/${command}`,
          {
            method: "POST",
            headers: authenticatedHeaders(authentication),
            body: JSON.stringify({ expectedRevision }),
          },
          env,
        );
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
          ok: true,
          changed: true,
          link: expect.objectContaining({ state, revision }),
        });
        return response;
      },
    );
  });

  it("pages Destination Version history newest first for an Archived Link", async () => {
    const authentication = await loginAdministrator();
    const createResponse = await app.request(
      "https://management.test/api/internal/links",
      {
        method: "POST",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({
          alias: "Docs",
          title: "Documentation",
          destination: "https://example.com/v1",
        }),
      },
      env,
    );
    const created = (await createResponse.json()) as { link: { id: string } };
    await buildSequentialFixtures(
      [
        [0, "https://example.com/v2"],
        [1, "https://example.com/v3"],
      ] as const,
      async ([expectedRevision, destination]) =>
        await app.request(
          `https://management.test/api/internal/links/${created.link.id}`,
          {
            method: "PATCH",
            headers: authenticatedHeaders(authentication),
            body: JSON.stringify({ expectedRevision, destination }),
          },
          env,
        ),
    );
    await app.request(
      `https://management.test/api/internal/links/${created.link.id}/archive`,
      {
        method: "POST",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({ expectedRevision: 2 }),
      },
      env,
    );

    const firstResponse = await app.request(
      `https://management.test/api/internal/links/${created.link.id}/destination-versions?limit=2`,
      { headers: { cookie: authentication.cookie } },
      env,
    );
    expect(firstResponse.status).toBe(200);
    const first = (await firstResponse.json()) as {
      items: Array<{ versionNumber: number; current: boolean; url: string }>;
      nextCursor: string | null;
    };
    expect(first).toEqual({
      ok: true,
      items: [
        expect.objectContaining({
          versionNumber: 3,
          current: true,
          url: "https://example.com/v3",
        }),
        expect.objectContaining({
          versionNumber: 2,
          current: false,
          url: "https://example.com/v2",
        }),
      ],
      nextCursor: expect.any(String),
    });
    if (first.nextCursor === null) throw new Error("expected a history cursor");

    const secondResponse = await app.request(
      `https://management.test/api/internal/links/${created.link.id}/destination-versions?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`,
      { headers: { cookie: authentication.cookie } },
      env,
    );
    expect(await secondResponse.json()).toEqual({
      ok: true,
      items: [
        expect.objectContaining({
          versionNumber: 1,
          current: false,
          url: "https://example.com/v1",
        }),
      ],
      nextCursor: null,
    });
  });
});
