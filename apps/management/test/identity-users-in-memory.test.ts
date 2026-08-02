import { describe, expect, it } from "vitest";

import { createInMemoryUserPersistence } from "../src/worker/identity/in-memory-users";
import { createUsers } from "../src/worker/identity/users";
import type { User } from "../src/worker/identity";

const administrator: User = {
  id: "administrator",
  email: "administrator@example.com",
  role: "administrator",
  state: "active",
};
const member: User = {
  id: "member",
  email: "member@example.com",
  role: "member",
  state: "active",
};

function createTestUsers(seed: readonly User[] = [administrator, member]) {
  return createUsers(createInMemoryUserPersistence(seed), {
    now: () => new Date("2026-07-26T00:00:00.000Z"),
    randomId: () => "audit-id",
  });
}

describe("Identity Users with in-memory persistence", () => {
  it("protects the last active Administrator", async () => {
    const users = createTestUsers();

    await expect(
      users.changeRole({
        actorId: administrator.id,
        userId: administrator.id,
        role: "member",
        recentlyAuthenticated: true,
      }),
    ).resolves.toEqual({ ok: false, kind: "last-active-administrator" });
    await expect(
      users.suspendUser({
        actorId: administrator.id,
        userId: administrator.id,
        recentlyAuthenticated: true,
      }),
    ).resolves.toEqual({ ok: false, kind: "last-active-administrator" });
  });

  it("requires recent authentication for Administrator role changes", async () => {
    const users = createTestUsers();

    await expect(
      users.changeRole({
        actorId: administrator.id,
        userId: member.id,
        role: "administrator",
        recentlyAuthenticated: false,
      }),
    ).resolves.toEqual({ ok: false, kind: "reauthentication-required" });
    await expect(
      users.changeRole({
        actorId: administrator.id,
        userId: member.id,
        role: "administrator",
        recentlyAuthenticated: true,
      }),
    ).resolves.toEqual({ ok: true, kind: "role-changed" });
  });

  it("suspends and reactivates a non-Administrator User", async () => {
    const users = createTestUsers();

    await expect(
      users.suspendUser({
        actorId: administrator.id,
        userId: member.id,
        recentlyAuthenticated: false,
      }),
    ).resolves.toEqual({ ok: true, kind: "user-suspended" });
    await expect(
      users.reactivateUser({ actorId: administrator.id, userId: member.id }),
    ).resolves.toMatchObject({
      ok: true,
      kind: "user-reactivated",
      user: { state: "active" },
    });
  });
});
