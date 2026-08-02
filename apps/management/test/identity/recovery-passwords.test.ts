import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { createIdentity } from "../../src/worker/identity";
import { resetIdentityDatabase } from "../support/management-database";

const now = new Date("2026-07-26T00:00:00.000Z");

describe("Identity recovery and passwords", () => {
  beforeEach(resetIdentityDatabase);

  it("resets an Active User password once and revokes every existing Session", async () => {
    let nextId = 0;
    const identity = createIdentity({
      db: env.DB,
      now: () => now,
      randomId: () => `generated-id-${++nextId}`,
      randomToken: () => `generated-token-${nextId}`,
    });
    await identity.writeInitialSetup({
      displayEmail: "Admin@Example.com",
      token: "setup-secret",
      expiresAt: new Date(now.getTime() + 30 * 60 * 1_000),
    });
    const setup = await identity.completeInitialSetup({
      token: "setup-secret",
      password: "violet glacier orbits quietly 729",
    });
    if (!setup.ok) {
      throw new Error("Expected setup to succeed");
    }
    const invitation = await identity.issueInvitation({
      actorId: setup.user.id,
      email: "Member@Example.com",
      role: "member",
    });
    if (!invitation.ok) {
      throw new Error("Expected Invitation issue to succeed");
    }
    const member = await identity.acceptInvitation({
      token: invitation.invitation.token,
      password: "ember constellations drift beyond 481",
    });
    if (!member.ok) {
      throw new Error("Expected Invitation acceptance to succeed");
    }
    const login = await identity.login({
      email: "member@example.com",
      password: "ember constellations drift beyond 481",
    });
    if (!login.ok) {
      throw new Error("Expected Member login to succeed");
    }

    const reset = await identity.issuePasswordReset({
      actorId: setup.user.id,
      userId: member.user.id,
    });
    if (!reset.ok) {
      throw new Error("Expected Password Reset issue to succeed");
    }
    await expect(
      identity.usePasswordReset({
        token: reset.passwordReset.token,
        password: "copper auroras navigate softly 864",
      }),
    ).resolves.toMatchObject({ ok: true, kind: "password-reset" });
    await expect(identity.authenticate(login.session.token)).resolves.toEqual({
      ok: false,
      kind: "invalid-credentials",
    });
    await expect(
      identity.usePasswordReset({
        token: reset.passwordReset.token,
        password: "another acceptable password 942",
      }),
    ).resolves.toEqual({ ok: false, kind: "invalid-or-expired-token" });
    await expect(
      identity.login({
        email: "member@example.com",
        password: "copper auroras navigate softly 864",
      }),
    ).resolves.toMatchObject({ ok: true, kind: "session" });
  });

  it("rotates a reauthenticated Session and revokes Sessions after password change and logout", async () => {
    let nextId = 0;
    const identity = createIdentity({
      db: env.DB,
      now: () => now,
      randomId: () => `generated-id-${++nextId}`,
      randomToken: () => `generated-token-${++nextId}`,
    });
    await identity.writeInitialSetup({
      displayEmail: "Admin@Example.com",
      token: "setup-secret",
      expiresAt: new Date(now.getTime() + 30 * 60 * 1_000),
    });
    const setup = await identity.completeInitialSetup({
      token: "setup-secret",
      password: "violet glacier orbits quietly 729",
    });
    if (!setup.ok) {
      throw new Error("Expected setup to succeed");
    }
    const login = await identity.login({
      email: "admin@example.com",
      password: "violet glacier orbits quietly 729",
    });
    if (!login.ok) {
      throw new Error("Expected login to succeed");
    }

    const reauthenticated = await identity.reauthenticate({
      token: login.session.token,
      password: "violet glacier orbits quietly 729",
    });
    expect(reauthenticated).toMatchObject({ ok: true, kind: "session" });
    if (!reauthenticated.ok) {
      throw new Error("Expected reauthentication to succeed");
    }
    expect(reauthenticated.session.token).not.toBe(login.session.token);
    await expect(identity.authenticate(login.session.token)).resolves.toEqual({
      ok: false,
      kind: "invalid-credentials",
    });

    await expect(
      identity.changePassword({
        userId: setup.user.id,
        currentPassword: "violet glacier orbits quietly 729",
        password: "silver monsoons trace horizons 357",
      }),
    ).resolves.toEqual({ ok: true, kind: "password-changed" });
    await expect(identity.authenticate(reauthenticated.session.token)).resolves.toEqual({
      ok: false,
      kind: "invalid-credentials",
    });

    const newLogin = await identity.login({
      email: "admin@example.com",
      password: "silver monsoons trace horizons 357",
    });
    if (!newLogin.ok) {
      throw new Error("Expected login with changed password to succeed");
    }
    await expect(identity.logout(newLogin.session.token)).resolves.toEqual({
      ok: true,
      kind: "logged-out",
    });
    await expect(identity.authenticate(newLogin.session.token)).resolves.toEqual({
      ok: false,
      kind: "invalid-credentials",
    });
  });

  it("recovers an existing Active Administrator without reopening setup", async () => {
    let nextId = 0;
    const identity = createIdentity({
      db: env.DB,
      now: () => now,
      randomId: () => `generated-id-${++nextId}`,
      randomToken: () => `generated-token-${++nextId}`,
    });
    await identity.writeInitialSetup({
      displayEmail: "Admin@Example.com",
      token: "setup-secret",
      expiresAt: new Date(now.getTime() + 30 * 60 * 1_000),
    });
    const setup = await identity.completeInitialSetup({
      token: "setup-secret",
      password: "violet glacier orbits quietly 729",
    });
    if (!setup.ok) {
      throw new Error("Expected setup to succeed");
    }
    const login = await identity.login({
      email: "admin@example.com",
      password: "violet glacier orbits quietly 729",
    });
    if (!login.ok) {
      throw new Error("Expected login to succeed");
    }
    await identity.writeOperatorRecovery({
      email: "admin@example.com",
      token: "operator-secret",
      expiresAt: new Date(now.getTime() + 30 * 60 * 1_000),
    });

    await expect(
      identity.useOperatorRecovery({
        token: "operator-secret",
        password: "opal galaxies cross midnight 518",
      }),
    ).resolves.toMatchObject({
      ok: true,
      kind: "operator-recovery",
      user: { id: setup.user.id, role: "administrator", state: "active" },
    });
    await expect(identity.authenticate(login.session.token)).resolves.toEqual({
      ok: false,
      kind: "invalid-credentials",
    });
    await expect(
      identity.writeInitialSetup({
        displayEmail: "Other@Example.com",
        token: "new-setup-secret",
        expiresAt: new Date(now.getTime() + 30 * 60 * 1_000),
      }),
    ).rejects.toThrow("Initial setup is permanently closed");
  });
});
