import type { Links } from "@shortflare/links";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

import { createLinksHttpRoutes } from "../../src/worker/modules/links/http/routes";

it("serves Links HTTP through injected application and authentication ports", async () => {
  const links: Links = {
    async execute() {
      throw new Error("Unexpected Link command");
    },
    async query() {
      return {
        ok: true,
        kind: "page",
        page: { items: [], nextCursor: null },
      };
    },
    async resolve() {
      throw new Error("Unexpected Alias resolution");
    },
  };
  const routes = createLinksHttpRoutes({
    createLinks: () => links,
    createRequestAuthentication: () => ({
      async authenticateSafe() {
        return {
          ok: true,
          user: {
            id: "injected-user",
            email: "User@Example.com",
            role: "member",
            state: "active",
          },
        };
      },
      async authenticateMutation() {
        throw new Error("Unexpected mutation authentication");
      },
    }),
    createRequestRateLimits: () => ({
      async consume() {
        return true;
      },
    }),
    hasCapability: () => true,
  });

  const response = await routes.request(
    "https://management.test/links",
    { headers: { cookie: "__Host-shortflare_session=injected-session" } },
    env,
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, items: [], nextCursor: null });
});
