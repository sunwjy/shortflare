import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { createIdentity } from "../../src/worker/modules/identity";
import { resetIdentityDatabase } from "../support/management-database";

const now = new Date("2026-07-26T00:00:00.000Z");

describe("Identity Invitations and Users", () => {
  beforeEach(resetIdentityDatabase);

  it("activates an Invited User who can then log in as a Member", async () => {
    let nextId = 0;
    const identity = createIdentity({
      db: env.DB,
      now: () => now,
      randomId: () => `generated-id-${++nextId}`,
      randomToken: () => `generated-token-${nextId}`,
    });
    await identity.initialSetup.writeInitialSetup({
      displayEmail: "Admin@Example.com",
      token: "setup-secret",
      expiresAt: new Date(now.getTime() + 30 * 60 * 1_000),
    });
    const setup = await identity.initialSetup.completeInitialSetup({
      token: "setup-secret",
      password: "violet glacier orbits quietly 729",
    });
    if (!setup.ok) {
      throw new Error("Expected setup to succeed");
    }

    const issued = await identity.invitations.issueInvitation({
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
      identity.invitations.acceptInvitation({
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
      identity.sessions.login({
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
    await identity.initialSetup.writeInitialSetup({
      displayEmail: "Admin@Example.com",
      token: "setup-secret",
      expiresAt: new Date(now.getTime() + 30 * 60 * 1_000),
    });
    const setup = await identity.initialSetup.completeInitialSetup({
      token: "setup-secret",
      password: "violet glacier orbits quietly 729",
    });
    if (!setup.ok) {
      throw new Error("Expected setup to succeed");
    }
    const first = await identity.invitations.issueInvitation({
      actorId: setup.user.id,
      email: "Invitee@Example.com",
      role: "viewer",
    });
    const replacement = await identity.invitations.issueInvitation({
      actorId: setup.user.id,
      email: "invitee@example.com",
      role: "member",
    });
    if (!first.ok || !replacement.ok) {
      throw new Error("Expected Invitations to be issued");
    }

    await expect(
      identity.invitations.acceptInvitation({
        token: first.invitation.token,
        password: "ember constellations drift beyond 481",
      }),
    ).resolves.toEqual({ ok: false, kind: "invalid-or-expired-token" });
    await expect(
      identity.invitations.cancelInvitation({
        actorId: setup.user.id,
        userId: replacement.invitation.user.id,
      }),
    ).resolves.toEqual({ ok: true, kind: "invitation-cancelled" });
    await expect(
      identity.invitations.issueInvitation({
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
    await identity.initialSetup.writeInitialSetup({
      displayEmail: "Admin@Example.com",
      token: "setup-secret",
      expiresAt: new Date(now.getTime() + 30 * 60 * 1_000),
    });
    const setup = await identity.initialSetup.completeInitialSetup({
      token: "setup-secret",
      password: "violet glacier orbits quietly 729",
    });
    if (!setup.ok) {
      throw new Error("Expected setup to succeed");
    }
    const invitation = await identity.invitations.issueInvitation({
      actorId: setup.user.id,
      email: "Member@Example.com",
      role: "member",
    });
    if (!invitation.ok) {
      throw new Error("Expected Invitation issue to succeed");
    }
    const member = await identity.invitations.acceptInvitation({
      token: invitation.invitation.token,
      password: "ember constellations drift beyond 481",
    });
    if (!member.ok) {
      throw new Error("Expected Invitation acceptance to succeed");
    }
    const login = await identity.sessions.login({
      email: "member@example.com",
      password: "ember constellations drift beyond 481",
    });
    if (!login.ok) {
      throw new Error("Expected Member login to succeed");
    }

    await expect(
      identity.users.changeRole({
        actorId: setup.user.id,
        userId: member.user.id,
        role: "viewer",
        recentlyAuthenticated: true,
      }),
    ).resolves.toEqual({ ok: true, kind: "role-changed" });
    await expect(identity.sessions.authenticate(login.session.token)).resolves.toEqual({
      ok: false,
      kind: "invalid-credentials",
    });
    await expect(
      identity.users.suspendUser({
        actorId: setup.user.id,
        userId: member.user.id,
        recentlyAuthenticated: true,
      }),
    ).resolves.toEqual({ ok: true, kind: "user-suspended" });
    await expect(
      identity.users.reactivateUser({ actorId: setup.user.id, userId: member.user.id }),
    ).resolves.toMatchObject({
      ok: true,
      kind: "user-reactivated",
      user: { role: "viewer", state: "active" },
    });
    await expect(
      identity.users.changeRole({
        actorId: setup.user.id,
        userId: setup.user.id,
        role: "member",
        recentlyAuthenticated: true,
      }),
    ).resolves.toEqual({ ok: false, kind: "last-active-administrator" });
  });
});
