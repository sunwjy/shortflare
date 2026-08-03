import { describe, expect, it } from "vitest";

import { createInMemoryPasswordResetPersistence } from "../src/worker/modules/identity/adapters/in-memory/password-resets";
import { createPasswordResets } from "../src/worker/modules/identity/application/password-resets";
import type { User } from "../src/worker/modules/identity";

const user: User = {
  id: "user",
  email: "user@example.com",
  role: "member",
  state: "active",
};

describe("Identity Password Resets with in-memory persistence", () => {
  it("issues and consumes a one-time reset through the capability interface", async () => {
    let nextId = 0;
    const resets = createPasswordResets(createInMemoryPasswordResetPersistence([user]), {
      now: () => new Date("2026-07-26T00:00:00.000Z"),
      randomId: () => `id-${++nextId}`,
      randomToken: () => "reset-token",
    });
    const issued = await resets.issuePasswordReset({
      actorId: "administrator",
      userId: user.id,
    });
    expect(issued).toMatchObject({
      ok: true,
      kind: "password-reset",
      passwordReset: { user, token: "reset-token" },
    });

    await expect(
      resets.usePasswordReset({
        token: "reset-token",
        password: "violet glacier orbits quietly 729",
      }),
    ).resolves.toEqual({ ok: true, kind: "password-reset", user });
    await expect(
      resets.usePasswordReset({
        token: "reset-token",
        password: "violet glacier orbits quietly 729",
      }),
    ).resolves.toEqual({ ok: false, kind: "invalid-or-expired-token" });
  });
});
