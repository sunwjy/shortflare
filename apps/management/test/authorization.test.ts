import { describe, expect, it } from "vitest";

import { type Capability, hasCapability } from "../src/worker/authorization";
import type { User, UserRole } from "../src/worker/identity";

describe("authorization", () => {
  it.each([
    ["administrator", ["create-link", "manage-users", "view-users"]],
    ["member", ["create-link"]],
    ["viewer", []],
  ] satisfies ReadonlyArray<readonly [UserRole, readonly Capability[]]>)(
    "maps %s to its capabilities",
    (role, expected) => {
      const expectedCapabilities: readonly Capability[] = expected;
      const user: User = {
        id: `${role}-id`,
        email: `${role}@example.com`,
        role,
        state: "active",
      };

      for (const capability of [
        "create-link",
        "manage-users",
        "view-users",
      ] satisfies Capability[]) {
        expect(hasCapability(user, capability)).toBe(expectedCapabilities.includes(capability));
      }
    },
  );
});
