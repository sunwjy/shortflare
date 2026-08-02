import { describe, expect, it } from "vitest";

import { createInMemoryOperatorRecoveryPersistence } from "../src/worker/identity/in-memory-operator-recovery";
import { createOperatorRecovery } from "../src/worker/identity/operator-recovery";
import type { User } from "../src/worker/identity";

const administrator: User = {
  id: "administrator",
  email: "Admin@Example.com",
  role: "administrator",
  state: "active",
};

describe("Identity Operator Recovery with in-memory persistence", () => {
  it("writes and consumes recovery once through the capability interface", async () => {
    const now = new Date("2026-07-26T00:00:00.000Z");
    const recovery = createOperatorRecovery(
      createInMemoryOperatorRecoveryPersistence([administrator]),
      { now: () => now, randomId: () => "audit-id" },
    );
    await recovery.writeOperatorRecovery({
      email: " admin@example.COM ",
      token: "recovery-token",
      expiresAt: new Date(now.getTime() + 30 * 60 * 1_000),
    });

    await expect(
      recovery.useOperatorRecovery({
        token: "recovery-token",
        password: "violet glacier orbits quietly 729",
      }),
    ).resolves.toEqual({
      ok: true,
      kind: "operator-recovery",
      user: administrator,
    });
    await expect(
      recovery.useOperatorRecovery({
        token: "recovery-token",
        password: "violet glacier orbits quietly 729",
      }),
    ).resolves.toEqual({ ok: false, kind: "invalid-or-expired-token" });
  });
});
