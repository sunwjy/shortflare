import { describe, expect, it } from "vitest";

import { type Capability, hasCapability } from "../src/worker/access-control";
import type { User, UserRole } from "../src/worker/modules/identity";

describe("authorization", () => {
  it.each([
    [
      "administrator",
      ["manage-links", "delete-links", "manage-reserved-aliases", "manage-users", "view-users"],
    ],
    ["member", ["manage-links"]],
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
        "manage-links",
        "delete-links",
        "manage-reserved-aliases",
        "manage-users",
        "view-users",
      ] satisfies Capability[]) {
        expect(hasCapability(user, capability)).toBe(expectedCapabilities.includes(capability));
      }
    },
  );
});
