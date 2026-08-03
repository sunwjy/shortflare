import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { app as managementApp } from "../../management/src/worker/index";
import { createIdentity } from "../../management/src/worker/modules/identity";
import redirectApp from "../src/index";
import { createTestExecutionContext } from "./execution-context";

describe("first end-to-end vertical slice", () => {
  it("creates a Link through Management and resolves it through Redirect", async () => {
    await createIdentity({ db: env.DB }).initialSetup.writeInitialSetup({
      displayEmail: "Admin@Example.com",
      token: "setup-secret",
      expiresAt: new Date(Date.now() + 30 * 60 * 1_000),
    });
    const setupResponse = await managementApp.request(
      "https://management.test/api/internal/auth/setup",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://management.test",
        },
        body: JSON.stringify({
          token: "setup-secret",
          password: "violet glacier orbits quietly 729",
        }),
      },
      env,
    );
    expect(setupResponse.status).toBe(201);
    const loginResponse = await managementApp.request(
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
    expect(loginResponse.status).toBe(200);
    const loginBody = (await loginResponse.json()) as { csrfToken: string };
    const cookie = loginResponse.headers.get("set-cookie")?.split(";", 1)[0];
    if (!cookie) {
      throw new Error("Expected login to set a Session cookie");
    }

    const createResponse = await managementApp.request(
      "https://management.test/api/internal/links",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          origin: "https://management.test",
          "x-csrf-token": loginBody.csrfToken,
        },
        body: JSON.stringify({
          alias: "Vertical",
          title: "Vertical Slice",
          destination: "https://example.com/guide?tag=stored",
        }),
      },
      env,
    );
    expect(createResponse.status).toBe(201);

    const execution = createTestExecutionContext();
    const redirectResponse = await redirectApp.request(
      "http://short.test/Vertical?tag=incoming&source=shortflare",
      {},
      env,
      execution.executionContext,
    );
    await execution.waitForPending();

    expect(redirectResponse.status).toBe(302);
    expect(redirectResponse.headers.get("location")).toBe(
      "https://example.com/guide?tag=stored&source=shortflare",
    );
  });
});
