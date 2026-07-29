import { describe, expect, it } from "vitest";

import { createInMemoryInvitationPersistence } from "../src/worker/identity/in-memory-invitations";
import { createInvitations } from "../src/worker/identity/invitations";

const now = new Date("2026-07-26T00:00:00.000Z");

function createTestInvitations() {
  let nextId = 0;
  return createInvitations({
    persistence: createInMemoryInvitationPersistence(),
    now: () => now,
    randomId: () => `id-${++nextId}`,
    randomToken: () => `token-${nextId}`,
  });
}

describe("Identity Invitations with in-memory persistence", () => {
  it("issues and consumes a one-time Invitation through the capability interface", async () => {
    const invitations = createTestInvitations();
    const issued = await invitations.issueInvitation({
      actorId: "administrator",
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
      },
    });
    if (!issued.ok) throw new Error("Expected Invitation issuance to succeed");

    await expect(
      invitations.acceptInvitation({
        token: issued.invitation.token,
        password: "violet glacier orbits quietly 729",
      }),
    ).resolves.toMatchObject({
      ok: true,
      kind: "user",
      user: { role: "member", state: "active" },
    });
    await expect(
      invitations.acceptInvitation({
        token: issued.invitation.token,
        password: "violet glacier orbits quietly 729",
      }),
    ).resolves.toEqual({ ok: false, kind: "invalid-or-expired-token" });
  });

  it("reissues and cancels an invited User without exposing persistence details", async () => {
    const invitations = createTestInvitations();
    const first = await invitations.issueInvitation({
      actorId: "administrator",
      email: "member@example.com",
      role: "viewer",
    });
    if (!first.ok) throw new Error("Expected Invitation issuance to succeed");
    const replacement = await invitations.issueInvitation({
      actorId: "administrator",
      email: "member@example.com",
      role: "member",
    });
    expect(replacement).toMatchObject({
      ok: true,
      invitation: {
        user: { id: first.invitation.user.id, role: "member" },
      },
    });

    await expect(
      invitations.cancelInvitation({
        actorId: "administrator",
        userId: first.invitation.user.id,
      }),
    ).resolves.toEqual({ ok: true, kind: "invitation-cancelled" });
    await expect(
      invitations.cancelInvitation({
        actorId: "administrator",
        userId: first.invitation.user.id,
      }),
    ).resolves.toEqual({ ok: false, kind: "invitation-not-found" });
  });
});
