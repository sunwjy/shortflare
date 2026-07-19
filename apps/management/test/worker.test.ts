import { describe, expect, it } from "vitest";

import app from "../src/worker/index";

describe("management worker", () => {
  it("reports its internal health", async () => {
    const response = await app.request("http://management.test/api/internal/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
