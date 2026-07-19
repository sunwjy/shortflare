import { describe, expect, it } from "vitest";

import { workspaceName } from "../src/index";

describe("links workspace", () => {
  it("exports its package identity", () => {
    expect(workspaceName).toBe("@shortflare/links");
  });
});
