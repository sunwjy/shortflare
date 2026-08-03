import { describe, expect, it } from "vitest";

import { createInMemoryInitialSetupPersistence } from "../src/worker/modules/identity/adapters/in-memory/initial-setup";
import { createInitialSetup } from "../src/worker/modules/identity/application/initial-setup";

describe("Identity Initial Setup with in-memory persistence", () => {
  it("permanently closes after consuming the setup token", async () => {
    const now = new Date("2026-07-26T00:00:00.000Z");
    const setup = createInitialSetup(createInMemoryInitialSetupPersistence(), {
      now: () => now,
      randomId: () => "generated-id",
    });
    await setup.writeInitialSetup({
      displayEmail: "Admin@Example.com",
      token: "setup-token",
      expiresAt: new Date(now.getTime() + 30 * 60 * 1_000),
    });

    await expect(
      setup.completeInitialSetup({
        token: "setup-token",
        password: "violet glacier orbits quietly 729",
      }),
    ).resolves.toMatchObject({
      ok: true,
      kind: "user",
      user: { email: "Admin@Example.com", role: "administrator", state: "active" },
    });
    await expect(
      setup.writeInitialSetup({
        displayEmail: "other@example.com",
        token: "replacement",
        expiresAt: new Date(now.getTime() + 30 * 60 * 1_000),
      }),
    ).rejects.toThrow("Initial setup is permanently closed");
  });
});
