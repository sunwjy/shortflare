import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { app as managementApp } from "../../management/src/worker/index";
import redirectApp from "../src/index";
import { createTestExecutionContext } from "./execution-context";

describe("first end-to-end vertical slice", () => {
  it("creates a Link through Management and resolves it through Redirect", async () => {
    const createResponse = await managementApp.request(
      "http://management.test/api/internal/links",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
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
