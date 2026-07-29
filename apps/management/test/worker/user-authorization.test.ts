import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { app } from "../../src/worker/index";
import { createIdentity } from "../../src/worker/identity";
import { resetManagementDatabase } from "../support/management-database";
import { authenticatedHeaders, loginAdministrator } from "../support/worker-authentication";

describe("management User authorization", () => {
  beforeEach(resetManagementDatabase);

  it("requires recent authentication only when suspending an Administrator", async () => {
    const administrator = await loginAdministrator();
    const administratorRecord = await env.DB.prepare(
      "SELECT id FROM users WHERE role = 'administrator'",
    ).first<{ id: string }>();
    if (!administratorRecord) {
      throw new Error("Expected Administrator");
    }
    const identity = createIdentity({ db: env.DB });
    const invitation = await identity.issueInvitation({
      actorId: administratorRecord.id,
      email: "Member@Example.com",
      role: "member",
    });
    if (!invitation.ok) {
      throw new Error("Expected invitation");
    }
    const member = await identity.acceptInvitation({
      token: invitation.invitation.token,
      password: "crimson satellites wander afar 286",
    });
    if (!member.ok) {
      throw new Error("Expected Member");
    }
    const staleAuthentication = Date.now() - 11 * 60 * 1_000;
    await env.DB.prepare("UPDATE sessions SET created_at = ?, recent_authentication_at = ?")
      .bind(staleAuthentication, staleAuthentication)
      .run();

    const roleResponse = await app.request(
      `https://management.test/api/internal/users/${member.user.id}/role`,
      {
        method: "POST",
        headers: authenticatedHeaders(administrator),
        body: JSON.stringify({ role: "viewer" }),
      },
      env,
    );
    expect(roleResponse.status).toBe(200);

    const memberResponse = await app.request(
      `https://management.test/api/internal/users/${member.user.id}/suspend`,
      {
        method: "POST",
        headers: authenticatedHeaders(administrator),
        body: "{}",
      },
      env,
    );
    expect(memberResponse.status).toBe(200);

    const administratorInvitation = await identity.issueInvitation({
      actorId: administratorRecord.id,
      email: "SecondAdmin@Example.com",
      role: "administrator",
    });
    if (!administratorInvitation.ok) {
      throw new Error("Expected Administrator invitation");
    }
    const secondAdministrator = await identity.acceptInvitation({
      token: administratorInvitation.invitation.token,
      password: "amber satellites wander afar 492",
    });
    if (!secondAdministrator.ok) {
      throw new Error("Expected second Administrator");
    }

    const response = await app.request(
      `https://management.test/api/internal/users/${secondAdministrator.user.id}/suspend`,
      {
        method: "POST",
        headers: authenticatedHeaders(administrator),
        body: "{}",
      },
      env,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      ok: false,
      kind: "reauthentication-required",
    });
    await expect(identity.getUser(secondAdministrator.user.id)).resolves.toMatchObject({
      state: "active",
    });
  });

  it("requires recent authentication when granting Administrator", async () => {
    const administrator = await loginAdministrator();
    const administratorRecord = await env.DB.prepare(
      "SELECT id FROM users WHERE role = 'administrator'",
    ).first<{ id: string }>();
    if (!administratorRecord) {
      throw new Error("Expected Administrator");
    }
    const identity = createIdentity({ db: env.DB });
    const invitation = await identity.issueInvitation({
      actorId: administratorRecord.id,
      email: "Member@Example.com",
      role: "member",
    });
    if (!invitation.ok) {
      throw new Error("Expected invitation");
    }
    const member = await identity.acceptInvitation({
      token: invitation.invitation.token,
      password: "crimson satellites wander afar 286",
    });
    if (!member.ok) {
      throw new Error("Expected Member");
    }
    const staleAuthentication = Date.now() - 11 * 60 * 1_000;
    await env.DB.prepare("UPDATE sessions SET created_at = ?, recent_authentication_at = ?")
      .bind(staleAuthentication, staleAuthentication)
      .run();

    const response = await app.request(
      `https://management.test/api/internal/users/${member.user.id}/role`,
      {
        method: "POST",
        headers: authenticatedHeaders(administrator),
        body: JSON.stringify({ role: "administrator" }),
      },
      env,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      ok: false,
      kind: "reauthentication-required",
    });
    await expect(identity.getUser(member.user.id)).resolves.toMatchObject({ role: "member" });

    const resetResponse = await app.request(
      `https://management.test/api/internal/users/${member.user.id}/password-resets`,
      {
        method: "POST",
        headers: authenticatedHeaders(administrator),
        body: "{}",
      },
      env,
    );
    expect(resetResponse.status).toBe(403);
    expect(await resetResponse.json()).toEqual({
      ok: false,
      kind: "reauthentication-required",
    });
  });
});
