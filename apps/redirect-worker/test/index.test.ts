import { describe, expect, it } from "vitest";

import app from "../src/index";

describe("redirect worker", () => {
  it("exposes the installation page", async () => {
    const response = await app.request("http://short.test/");

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Shortflare is installed.");
  });
});
