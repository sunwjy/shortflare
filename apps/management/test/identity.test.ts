import { env } from "cloudflare:workers";
import { Buffer } from "node:buffer";
import { scrypt } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { createIdentity } from "../src/worker/identity";

const now = new Date("2026-07-26T00:00:00.000Z");

describe("Identity", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM audit_events"),
      env.DB.prepare("DELETE FROM sessions"),
      env.DB.prepare("DELETE FROM credentials"),
      env.DB.prepare("DELETE FROM invitations"),
      env.DB.prepare("DELETE FROM password_resets"),
      env.DB.prepare("DELETE FROM operator_recovery"),
      env.DB.prepare("DELETE FROM users"),
      env.DB.prepare("DELETE FROM initial_setup"),
      env.DB.prepare("UPDATE instances SET setup_completed_at = NULL WHERE singleton_key = 1"),
    ]);
  });

  it("consumes Setup Token once to activate the initial Administrator", async () => {
    const identity = createIdentity({
      db: env.DB,
      now: () => now,
      randomId: () => "generated-id",
    });
    await identity.writeInitialSetup({
      displayEmail: "Admin@Example.com",
      token: "setup-secret",
      expiresAt: new Date(now.getTime() + 30 * 60 * 1_000),
    });

    const result = await identity.completeInitialSetup({
      token: "setup-secret",
      password: "violet glacier orbits quietly 729",
    });

    expect(result).toEqual({
      ok: true,
      kind: "user",
      user: {
        id: "generated-id",
        email: "Admin@Example.com",
        role: "administrator",
        state: "active",
      },
    });
    await expect(
      identity.completeInitialSetup({
        token: "setup-secret",
        password: "violet glacier orbits quietly 729",
      }),
    ).resolves.toEqual({ ok: false, kind: "invalid-or-expired-token" });
  });

  it("creates a server-side Session when an Active User logs in", async () => {
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
    await identity.completeInitialSetup({
      token: "setup-secret",
      password: "violet glacier orbits quietly 729",
    });

    const result = await identity.login({
      email: " admin@example.COM ",
      password: "violet glacier orbits quietly 729",
    });

    expect(result).toMatchObject({
      ok: true,
      kind: "session",
      session: {
        user: {
          id: "generated-id-1",
          email: "Admin@Example.com",
          role: "administrator",
          state: "active",
        },
      },
    });
    if (!result.ok) {
      throw new Error("Expected login to succeed");
    }
    await expect(identity.authenticate(result.session.token)).resolves.toEqual({
      ok: true,
      kind: "user",
      user: result.session.user,
    });
  });

  it("keeps safe Session reads side-effect free while mutations extend idle expiry hourly", async () => {
    let currentTime = now;
    let nextId = 0;
    const identity = createIdentity({
      db: env.DB,
      now: () => currentTime,
      randomId: () => `generated-id-${++nextId}`,
      randomToken: () => `generated-token-${++nextId}`,
    });
    await identity.writeInitialSetup({
      displayEmail: "Admin@Example.com",
      token: "setup-secret",
      expiresAt: new Date(now.getTime() + 30 * 60 * 1_000),
    });
    await identity.completeInitialSetup({
      token: "setup-secret",
      password: "violet glacier orbits quietly 729",
    });
    const login = await identity.login({
      email: "admin@example.com",
      password: "violet glacier orbits quietly 729",
    });
    if (!login.ok) {
      throw new Error("Expected login to succeed");
    }
    const beforeRead = await readSessionTimes();

    const opened = await identity.openSession(login.session.token);

    expect(opened).toMatchObject({
      ok: true,
      session: { csrfToken: login.session.csrfToken },
    });
    await expect(readSessionTimes()).resolves.toEqual(beforeRead);

    currentTime = new Date(now.getTime() + 60 * 60 * 1_000);
    await expect(
      identity.authenticateRequest(login.session.token, login.session.csrfToken),
    ).resolves.toMatchObject({ ok: true, kind: "user" });
    const afterFirstMutation = await readSessionTimes();
    expect(afterFirstMutation.lastSeenAt).toBe(currentTime.getTime());

    currentTime = new Date(now.getTime() + 90 * 60 * 1_000);
    await expect(
      identity.authenticateRequest(login.session.token, login.session.csrfToken),
    ).resolves.toMatchObject({ ok: true, kind: "user" });
    await expect(readSessionTimes()).resolves.toEqual(afterFirstMutation);

    currentTime = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000 + 30 * 60 * 1_000);
    await expect(identity.authenticate(login.session.token)).resolves.toMatchObject({
      ok: true,
      kind: "user",
    });
  });

  it("rehashes a whitelisted legacy scrypt verifier after successful login", async () => {
    const identity = createIdentity({ db: env.DB, now: () => now });
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
    const legacyVerifier = await createLegacyVerifier("violet glacier orbits quietly 729");
    await env.DB.prepare("UPDATE credentials SET verifier = ? WHERE user_id = ?")
      .bind(legacyVerifier, setup.user.id)
      .run();

    await expect(
      identity.login({
        email: "admin@example.com",
        password: "violet glacier orbits quietly 729",
      }),
    ).resolves.toMatchObject({ ok: true, kind: "session" });

    const credential = await env.DB.prepare("SELECT verifier FROM credentials WHERE user_id = ?")
      .bind(setup.user.id)
      .first<{ verifier: string }>();
    expect(credential?.verifier).toContain("$N=32768,r=8,p=1,l=32$");
  });

  it("rejects malformed ASCII email addresses", async () => {
    const identity = createIdentity({ db: env.DB, now: () => now });

    await Promise.all(
      [
        "a@.",
        "a@-",
        "two@@example.com",
        "missing-tld@example",
        ".a@example.com",
        "a..b@example.com",
        `${"a".repeat(65)}@example.com`,
      ].map((email) =>
        expect(
          identity.issueInvitation({
            actorId: "administrator",
            email,
            role: "member",
          }),
        ).resolves.toEqual({ ok: false, kind: "invalid-email" }),
      ),
    );
  });

  it("activates an Invited User who can then log in as a Member", async () => {
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

    const issued = await identity.issueInvitation({
      actorId: setup.user.id,
      email: "Member@Example.com",
      role: "member",
    });
    expect(issued).toMatchObject({
      ok: true,
      kind: "invitation",
      invitation: {
        user: {
          email: "Member@Example.com",
          role: "member",
          state: "invited",
        },
        token: expect.any(String),
      },
    });
    if (!issued.ok) {
      throw new Error("Expected Invitation issue to succeed");
    }

    await expect(
      identity.acceptInvitation({
        token: issued.invitation.token,
        password: "ember constellations drift beyond 481",
      }),
    ).resolves.toMatchObject({
      ok: true,
      kind: "user",
      user: {
        email: "Member@Example.com",
        role: "member",
        state: "active",
      },
    });
    await expect(
      identity.login({
        email: "member@example.com",
        password: "ember constellations drift beyond 481",
      }),
    ).resolves.toMatchObject({ ok: true, kind: "session" });
  });

  it("replaces an Invitation and removes a cancelled Invited User", async () => {
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
    const first = await identity.issueInvitation({
      actorId: setup.user.id,
      email: "Invitee@Example.com",
      role: "viewer",
    });
    const replacement = await identity.issueInvitation({
      actorId: setup.user.id,
      email: "invitee@example.com",
      role: "member",
    });
    if (!first.ok || !replacement.ok) {
      throw new Error("Expected Invitations to be issued");
    }

    await expect(
      identity.acceptInvitation({
        token: first.invitation.token,
        password: "ember constellations drift beyond 481",
      }),
    ).resolves.toEqual({ ok: false, kind: "invalid-or-expired-token" });
    await expect(
      identity.cancelInvitation({
        actorId: setup.user.id,
        userId: replacement.invitation.user.id,
      }),
    ).resolves.toEqual({ ok: true, kind: "invitation-cancelled" });
    await expect(
      identity.issueInvitation({
        actorId: setup.user.id,
        email: "Invitee@Example.com",
        role: "viewer",
      }),
    ).resolves.toMatchObject({ ok: true, kind: "invitation" });
  });

  it("revokes Sessions across role and suspension changes while protecting the last Administrator", async () => {
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

    await expect(
      identity.changeRole({
        actorId: setup.user.id,
        userId: member.user.id,
        role: "viewer",
        recentlyAuthenticated: true,
      }),
    ).resolves.toEqual({ ok: true, kind: "role-changed" });
    await expect(identity.authenticate(login.session.token)).resolves.toEqual({
      ok: false,
      kind: "invalid-credentials",
    });
    await expect(
      identity.suspendUser({
        actorId: setup.user.id,
        userId: member.user.id,
        recentlyAuthenticated: true,
      }),
    ).resolves.toEqual({ ok: true, kind: "user-suspended" });
    await expect(
      identity.reactivateUser({ actorId: setup.user.id, userId: member.user.id }),
    ).resolves.toMatchObject({
      ok: true,
      kind: "user-reactivated",
      user: { role: "viewer", state: "active" },
    });
    await expect(
      identity.changeRole({
        actorId: setup.user.id,
        userId: setup.user.id,
        role: "member",
        recentlyAuthenticated: true,
      }),
    ).resolves.toEqual({ ok: false, kind: "last-active-administrator" });
  });

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

async function readSessionTimes() {
  const row = await env.DB.prepare(
    "SELECT last_seen_at AS lastSeenAt, idle_expires_at AS idleExpiresAt FROM sessions",
  ).first<{ lastSeenAt: number; idleExpiresAt: number }>();
  if (!row) {
    throw new Error("Expected Session to exist");
  }
  return row;
}

async function createLegacyVerifier(password: string) {
  const salt = new Uint8Array(16).fill(7);
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password.normalize("NFC"),
      salt,
      32,
      {
        N: 16_384,
        r: 8,
        p: 1,
        maxmem: 32 * 1_024 * 1_024,
      },
      (error, value) => {
        if (error) {
          reject(error);
        } else {
          resolve(value);
        }
      },
    );
  });
  return `scrypt$v=1$N=16384,r=8,p=1,l=32$${Buffer.from(salt).toString("base64url")}$${derived.toString("base64url")}`;
}
