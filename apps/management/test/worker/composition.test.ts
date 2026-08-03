import type { LinkQueryResult, Links } from "@shortflare/links";
import { parseAlias } from "@shortflare/links";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { createManagementApp } from "../../src/worker/app";
import { createIdentity } from "../../src/worker/identity";
import { resetManagementDatabase } from "../support/management-database";

describe("management app composition", () => {
  beforeEach(resetManagementDatabase);

  it("serves a Link page from injected Management modules", async () => {
    const alias = parseAlias("Injected");
    if (alias === null) throw new Error("Expected a valid test Alias");

    const links: Links = {
      async execute() {
        throw new Error("Unexpected Link command");
      },
      async query(): Promise<LinkQueryResult> {
        return {
          ok: true,
          kind: "page",
          page: {
            items: [
              {
                id: "injected-link",
                alias,
                title: "Injected Link",
                state: "active",
                revision: 1,
                currentDestinationVersion: {
                  id: "injected-destination",
                  versionNumber: 1,
                  destination: "https://example.com/injected",
                  createdAt: new Date("2026-08-03T00:00:00.000Z"),
                },
                createdAt: new Date("2026-08-03T00:00:00.000Z"),
                updatedAt: new Date("2026-08-03T00:00:00.000Z"),
              },
            ],
            nextCursor: null,
          },
        };
      },
      async resolve() {
        throw new Error("Unexpected Alias resolution");
      },
    };
    const testApp = createManagementApp({
      createIdentity: (bindings) => createIdentity({ db: bindings.DB }),
      createLinks: () => links,
    });
    const identity = createIdentity({ db: env.DB });
    await identity.writeInitialSetup({
      displayEmail: "Admin@Example.com",
      token: "setup-secret",
      expiresAt: new Date(Date.now() + 30 * 60 * 1_000),
    });
    await identity.completeInitialSetup({
      token: "setup-secret",
      password: "violet glacier orbits quietly 729",
    });
    const loginResponse = await testApp.request(
      "https://management.test/api/internal/auth/login",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://management.test",
        },
        body: JSON.stringify({
          email: "admin@example.com",
          password: "violet glacier orbits quietly 729",
        }),
      },
      env,
    );
    const cookie = loginResponse.headers.get("set-cookie")?.split(";", 1)[0];
    if (!cookie) throw new Error("Expected login to set a Session cookie");

    const response = await testApp.request(
      "https://management.test/api/internal/links",
      { headers: { cookie } },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      items: [
        {
          id: "injected-link",
          alias: "Injected",
          shortUrl: "https://short.test/Injected",
          title: "Injected Link",
          state: "active",
          revision: 1,
          destination: {
            id: "injected-destination",
            versionNumber: 1,
            url: "https://example.com/injected",
            createdAt: "2026-08-03T00:00:00.000Z",
          },
          createdAt: "2026-08-03T00:00:00.000Z",
          updatedAt: "2026-08-03T00:00:00.000Z",
        },
      ],
      nextCursor: null,
    });
  });
});
