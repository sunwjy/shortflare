import { describe, expect, it } from "vitest";

import { workspaceName } from "../src/index";

describe("deploy workspace", () => {
  it("exports its package identity", () => {
    expect(workspaceName).toBe("shortflare");
  });
});
