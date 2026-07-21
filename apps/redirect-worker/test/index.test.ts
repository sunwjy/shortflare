import { describe, expect, it } from "vitest";

import app from "../src/index";

describe("redirect worker", () => {
  it("exposes the installation page", async () => {
    const response = await app.request("http://short.test/");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Shortflare is installed.");
  });

  it("does not expose integration probes without the test binding", async () => {
    const response = await app.request(
      "http://short.test/__shortflare/integration/queue/probe-id",
      { method: "POST" },
      {},
    );

    expect(response.status).toBe(404);
  });
});
