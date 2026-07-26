import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { createD1LinksPersistence } from "@shortflare/database";
import { createLinks } from "@shortflare/links";
import app from "../src/index";
import { createTestExecutionContext } from "./execution-context";

describe("redirect worker", () => {
  it("exposes the installation page", async () => {
    const response = await app.request("http://short.test/");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it("redirects an Active Link with stored query values winning collisions", async () => {
    const links = createLinks({
      persistence: createD1LinksPersistence(env.DB),
      redirectDomain: "short.test",
    });
    const created = await links.execute(
      {
        kind: "create",
        alias: "Docs",
        title: "Documentation",
        destination: "https://example.com/guide?tag=stored",
      },
      { id: "system:test" },
    );
    expect(created.ok).toBe(true);

    const response = await app.request(
      "http://short.test/Docs?tag=incoming&source=shortflare",
      {},
      env,
      createTestExecutionContext().executionContext,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://example.com/guide?tag=stored&source=shortflare",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects methods other than GET and HEAD before routing", async () => {
    const response = await app.request("http://short.test/Unknown", { method: "POST" }, env);

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each(["/Docs/", "/Docs/extra", "/%"])(
    "rejects a path that is not exactly one valid Alias segment: %s",
    async (path) => {
      const response = await app.request(
        `http://short.test${path}`,
        {},
        env,
        createTestExecutionContext().executionContext,
      );

      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
    },
  );

  it("caches only the Alias resolution while merging each request query", async () => {
    const links = createLinks({
      persistence: createD1LinksPersistence(env.DB),
      redirectDomain: "short.test",
    });
    const created = await links.execute(
      {
        kind: "create",
        alias: "Cached",
        title: "Cached Link",
        destination: "https://example.com/guide?tag=stored",
      },
      { id: "system:test" },
    );
    if (!created.ok || created.kind !== "link") {
      throw new Error("expected Link creation to succeed");
    }

    const firstContext = createTestExecutionContext();
    const firstResponse = await app.request(
      "http://short.test/Cached?source=first",
      {},
      env,
      firstContext.executionContext,
    );
    expect(firstResponse.status).toBe(302);
    await firstContext.waitForPending();

    await links.execute({ kind: "disable", linkId: created.link.id }, { id: "system:test" });
    const secondResponse = await app.request(
      "http://short.test/Cached?source=second",
      {},
      env,
      createTestExecutionContext().executionContext,
    );

    expect(secondResponse.status).toBe(302);
    expect(secondResponse.headers.get("location")).toBe(
      "https://example.com/guide?tag=stored&source=second",
    );
  });

  it("caches an unknown Alias decision for the five-second visibility window", async () => {
    const firstContext = createTestExecutionContext();
    const firstResponse = await app.request(
      "http://short.test/Later",
      {},
      env,
      firstContext.executionContext,
    );
    expect(firstResponse.status).toBe(404);
    await firstContext.waitForPending();

    const links = createLinks({
      persistence: createD1LinksPersistence(env.DB),
      redirectDomain: "short.test",
    });
    await links.execute(
      {
        kind: "create",
        alias: "Later",
        title: "Created Later",
        destination: "https://example.com/later",
      },
      { id: "system:test" },
    );
    const secondResponse = await app.request(
      "http://short.test/Later",
      {},
      env,
      createTestExecutionContext().executionContext,
    );

    expect(secondResponse.status).toBe(404);
  });

  it("maps Link states and Reserved Aliases to their redirect status", async () => {
    const links = createLinks({
      persistence: createD1LinksPersistence(env.DB),
      redirectDomain: "short.test",
    });
    const actor = { id: "system:test" };

    const disabled = await links.execute(
      {
        kind: "create",
        alias: "Disabled",
        title: "Disabled Link",
        destination: "https://example.com/disabled",
      },
      actor,
    );
    const archived = await links.execute(
      {
        kind: "create",
        alias: "Archived",
        title: "Archived Link",
        destination: "https://example.com/archived",
      },
      actor,
    );
    const reserved = await links.execute(
      {
        kind: "create",
        alias: "Reserved",
        title: "Reserved Alias",
        destination: "https://example.com/reserved",
      },
      actor,
    );
    if (
      !disabled.ok ||
      disabled.kind !== "link" ||
      !archived.ok ||
      archived.kind !== "link" ||
      !reserved.ok ||
      reserved.kind !== "link"
    ) {
      throw new Error("expected Link fixtures to be created");
    }
    await links.execute({ kind: "disable", linkId: disabled.link.id }, actor);
    await links.execute({ kind: "archive", linkId: archived.link.id }, actor);
    await links.execute({ kind: "archive", linkId: reserved.link.id }, actor);
    await links.execute({ kind: "permanently-delete", linkId: reserved.link.id }, actor);

    const results = await Promise.all(
      (
        [
          ["Unknown", 404],
          ["Disabled", 404],
          ["Archived", 410],
          ["Reserved", 410],
        ] as const
      ).map(async ([alias, expectedStatus]) => {
        const execution = createTestExecutionContext();
        const response = await app.request(
          `http://short.test/${alias}`,
          {},
          env,
          execution.executionContext,
        );
        await execution.waitForPending();
        return { alias, expectedStatus, response };
      }),
    );
    for (const { alias, expectedStatus, response } of results) {
      expect(response.status, alias).toBe(expectedStatus);
      expect(response.headers.get("cache-control"), alias).toBe("no-store");
    }
  });

  it("returns redirect headers without a body for HEAD", async () => {
    const links = createLinks({
      persistence: createD1LinksPersistence(env.DB),
      redirectDomain: "short.test",
    });
    await links.execute(
      {
        kind: "create",
        alias: "Head",
        title: "HEAD Link",
        destination: "https://example.com/head",
      },
      { id: "system:test" },
    );

    const response = await app.request(
      "http://short.test/Head",
      { method: "HEAD" },
      env,
      createTestExecutionContext().executionContext,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/head");
    expect(await response.text()).toBe("");
  });

  it("returns a non-cacheable service error when D1 resolution fails", async () => {
    const failingDatabase = {
      prepare() {
        throw new Error("database unavailable");
      },
    } as unknown as D1Database;

    const response = await app.request(
      "http://short.test/Unavailable",
      {},
      { DB: failingDatabase },
      createTestExecutionContext().executionContext,
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("");
  });
});
