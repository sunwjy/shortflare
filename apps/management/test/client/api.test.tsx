import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, ApiProtocolError, jsonRequest, noContentRequest } from "../../src/client/api";

const responseSchema = z.strictObject({
  ok: z.literal(true),
  value: z.string(),
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("client API boundary", () => {
  it("returns only a response validated by the caller schema", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true, value: "validated" })),
    );

    await expect(jsonRequest("/test", responseSchema)).resolves.toEqual({
      ok: true,
      value: "validated",
    });
  });

  it("reports DTO drift as a protocol error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: true, value: 42 })),
    );

    await expect(jsonRequest("/test", responseSchema)).rejects.toBeInstanceOf(ApiProtocolError);
  });

  it("reports a proxy HTML response without leaking a JSON SyntaxError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<h1>Bad gateway</h1>", { status: 502 })),
    );

    await expect(jsonRequest("/test", responseSchema)).rejects.toMatchObject({
      name: "ApiProtocolError",
      status: 502,
    });
  });

  it("validates and normalizes the common error envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ok: false, kind: "forbidden" }, { status: 403 })),
    );

    await expect(jsonRequest("/test", responseSchema)).rejects.toEqual(
      new ApiError(403, { ok: false, kind: "forbidden", details: {} }),
    );
  });

  it("keeps no-content requests distinct from JSON requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );

    await expect(noContentRequest("/test", { method: "POST" })).resolves.toBeUndefined();
    await expect(jsonRequest("/test", responseSchema)).rejects.toBeInstanceOf(ApiProtocolError);
  });
});
