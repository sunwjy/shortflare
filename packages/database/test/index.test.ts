import { describe, expect, it } from "vitest";

import { workspaceName } from "../src/index";

describe("database workspace", () => {
  it("exports its package identity", () => {
    expect(workspaceName).toBe("@shortflare/database");
  });
});
