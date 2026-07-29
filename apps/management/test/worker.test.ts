import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { buildSequentialFixtures } from "../../../test/support/sequential-fixtures";
import { app } from "../src/worker/index";
import { createIdentity } from "../src/worker/identity";

describe("management worker", () => {
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
      env.DB.prepare("DELETE FROM destination_versions"),
      env.DB.prepare("DELETE FROM aliases"),
      env.DB.prepare("DELETE FROM links"),
      env.DB.prepare("UPDATE instances SET setup_completed_at = NULL WHERE singleton_key = 1"),
    ]);
  });

  it("reports its internal health", async () => {
    const response = await app.request("http://management.test/api/internal/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("returns the common API error without storage details for an unexpected failure", async () => {
    const failingDatabase = new Proxy(env.DB, {
      get() {
        throw new Error("sensitive storage failure");
      },
    });
    const response = await app.request(
      "https://management.test/api/internal/links",
      { headers: { cookie: "__Host-shortflare_session=broken" } },
      { DB: failingDatabase, REDIRECT_DOMAIN: "short.test" },
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ok: false,
      kind: "internal-error",
      details: {},
    });
  });

  it("sets up the initial Administrator and logs in with a secure Session cookie", async () => {
    await createIdentity({ db: env.DB }).writeInitialSetup({
      displayEmail: "Admin@Example.com",
      token: "setup-secret",
      expiresAt: new Date(Date.now() + 30 * 60 * 1_000),
    });
    const setupResponse = await app.request(
      "https://management.test/api/internal/auth/setup",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://management.test",
        },
        body: JSON.stringify({
          token: "setup-secret",
          password: "violet glacier orbits quietly 729",
        }),
      },
      env,
    );
    expect(setupResponse.status).toBe(201);

    const loginResponse = await app.request(
      "https://management.test/api/internal/auth/login",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://management.test",
        },
        body: JSON.stringify({
          email: "admin@example.com",
          password: "violet glacier orbits quietly 729",
        }),
      },
      env,
    );

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.headers.get("set-cookie")).toMatch(
      /^__Host-shortflare_session=.+; Max-Age=\d+; Path=\/; HttpOnly; Secure; SameSite=Lax$/,
    );
    expect(await loginResponse.json()).toMatchObject({
      ok: true,
      user: {
        email: "Admin@Example.com",
        role: "administrator",
        state: "active",
      },
      csrfToken: expect.any(String),
    });
  });

  it("rejects cross-origin login and a mutation without its Session CSRF Token", async () => {
    const crossOrigin = await app.request(
      "https://management.test/api/internal/auth/login",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.test",
        },
        body: JSON.stringify({
          email: "admin@example.com",
          password: "violet glacier orbits quietly 729",
        }),
      },
      env,
    );
    expect(crossOrigin.status).toBe(403);

    const authentication = await loginAdministrator();
    const response = await app.request(
      "https://management.test/api/internal/links",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: authentication.cookie,
          origin: "https://management.test",
        },
        body: JSON.stringify({
          alias: "NoCsrf",
          title: "No CSRF",
          destination: "https://example.com/no-csrf",
        }),
      },
      env,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      ok: false,
      kind: "invalid-csrf-token",
      details: {},
    });
  });

  it("rejects unauthenticated Link creation", async () => {
    const response = await app.request(
      "https://management.test/api/internal/links",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://management.test",
        },
        body: JSON.stringify({
          alias: "Docs",
          title: "Documentation",
          destination: "https://example.com/guide",
        }),
      },
      env,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      kind: "unauthenticated",
      details: {},
    });
  });

  it("lets a Viewer read Links but forbids Link mutation", async () => {
    const administrator = await loginAdministrator();
    const issueResponse = await app.request(
      "https://management.test/api/internal/users/invitations",
      {
        method: "POST",
        headers: authenticatedHeaders(administrator),
        body: JSON.stringify({
          email: "Viewer@Example.com",
          role: "viewer",
        }),
      },
      env,
    );
    expect(issueResponse.status).toBe(201);
    const issueBody = (await issueResponse.json()) as {
      invitation: { token: string };
    };
    const acceptResponse = await app.request(
      "https://management.test/api/internal/auth/invitations/accept",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://management.test",
        },
        body: JSON.stringify({
          token: issueBody.invitation.token,
          password: "crimson satellites wander afar 286",
        }),
      },
      env,
    );
    expect(acceptResponse.status).toBe(200);
    const viewer = await loginUser("viewer@example.com", "crimson satellites wander afar 286");
    await app.request(
      "https://management.test/api/internal/links",
      {
        method: "POST",
        headers: authenticatedHeaders(administrator),
        body: JSON.stringify({
          alias: "Readable",
          title: "Readable",
          destination: "https://example.com/readable",
        }),
      },
      env,
    );
    const listResponse = await app.request(
      "https://management.test/api/internal/links",
      {
        headers: { cookie: viewer.cookie },
      },
      env,
    );
    expect(listResponse.status).toBe(200);

    const response = await app.request(
      "https://management.test/api/internal/links",
      {
        method: "POST",
        headers: authenticatedHeaders(viewer),
        body: JSON.stringify({
          alias: "Forbidden",
          title: "Forbidden",
          destination: "https://example.com/forbidden",
        }),
      },
      env,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      ok: false,
      kind: "forbidden",
      details: {},
    });
  });

  it("lets a Member manage Links but not Reserved Aliases", async () => {
    await loginAdministrator();
    const administratorRecord = await env.DB.prepare(
      "SELECT id FROM users WHERE role = 'administrator'",
    ).first<{ id: string }>();
    if (!administratorRecord) throw new Error("Expected Administrator");
    const identity = createIdentity({ db: env.DB });
    const invitation = await identity.issueInvitation({
      actorId: administratorRecord.id,
      email: "Member@Example.com",
      role: "member",
    });
    if (!invitation.ok) throw new Error("Expected Member invitation");
    await identity.acceptInvitation({
      token: invitation.invitation.token,
      password: "crimson satellites wander afar 286",
    });
    const member = await loginUser("member@example.com", "crimson satellites wander afar 286");

    const createResponse = await app.request(
      "https://management.test/api/internal/links",
      {
        method: "POST",
        headers: authenticatedHeaders(member),
        body: JSON.stringify({
          alias: "MemberLink",
          title: "Member Link",
          destination: "https://example.com/member",
        }),
      },
      env,
    );
    expect(createResponse.status).toBe(201);

    const reservedAliasesResponse = await app.request(
      "https://management.test/api/internal/reserved-aliases",
      { headers: { cookie: member.cookie } },
      env,
    );
    expect(reservedAliasesResponse.status).toBe(403);
    expect(await reservedAliasesResponse.json()).toEqual({
      ok: false,
      kind: "forbidden",
      details: {},
    });
  });

  it("reads the current Session without rotating CSRF and logs out that Session", async () => {
    const authentication = await loginAdministrator();
    const sessionResponse = await app.request(
      "https://management.test/api/internal/auth/session",
      { headers: { cookie: authentication.cookie } },
      env,
    );
    expect(sessionResponse.status).toBe(200);
    const sessionBody = (await sessionResponse.json()) as { csrfToken: string };
    expect(sessionBody.csrfToken).toBe(authentication.csrfToken);

    const logoutResponse = await app.request(
      "https://management.test/api/internal/auth/logout",
      {
        method: "POST",
        headers: authenticatedHeaders({
          cookie: authentication.cookie,
          csrfToken: sessionBody.csrfToken,
        }),
        body: "{}",
      },
      env,
    );

    expect(logoutResponse.status).toBe(204);
    expect(logoutResponse.headers.get("set-cookie")).toContain("__Host-shortflare_session=;");
    const response = await app.request(
      "https://management.test/api/internal/links",
      {
        method: "POST",
        headers: authenticatedHeaders({
          cookie: authentication.cookie,
          csrfToken: sessionBody.csrfToken,
        }),
        body: JSON.stringify({
          alias: "AfterLogout",
          title: "After Logout",
          destination: "https://example.com/after-logout",
        }),
      },
      env,
    );
    expect(response.status).toBe(401);
  });

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

  it("creates a Link as an authenticated Administrator", async () => {
    const authentication = await loginAdministrator();
    const response = await app.request(
      "https://management.test/api/internal/links",
      {
        method: "POST",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({
          alias: "Docs",
          title: "Documentation",
          destination: "https://example.com/guide",
        }),
      },
      env,
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      ok: true,
      link: {
        id: expect.any(String),
        alias: "Docs",
        shortUrl: "https://short.test/Docs",
        title: "Documentation",
        state: "active",
        revision: 0,
        destination: {
          id: expect.any(String),
          versionNumber: 1,
          url: "https://example.com/guide",
          createdAt: expect.any(String),
        },
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
    });
  });

  it("generates an Alias only when the create request omits it", async () => {
    const authentication = await loginAdministrator();
    const response = await app.request(
      "https://management.test/api/internal/links",
      {
        method: "POST",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({
          title: "Generated",
          destination: "https://example.com/generated",
        }),
      },
      env,
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      link: { alias: string; shortUrl: string };
    };
    expect(body.link.alias).toMatch(/^[0-9A-Za-z]{6}$/);
    expect(body.link.shortUrl).toBe(`https://short.test/${body.link.alias}`);
  });

  it("lists and reads Links through the common transport DTO", async () => {
    const authentication = await loginAdministrator();
    const createResponse = await app.request(
      "https://management.test/api/internal/links",
      {
        method: "POST",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({
          alias: "Docs",
          title: "Documentation",
          destination: "https://example.com/guide",
        }),
      },
      env,
    );
    const created = (await createResponse.json()) as { link: { id: string } };

    const listResponse = await app.request(
      "https://management.test/api/internal/links?search=docs&state=active&limit=10",
      { headers: { cookie: authentication.cookie } },
      env,
    );
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toEqual({
      ok: true,
      items: [
        expect.objectContaining({
          id: created.link.id,
          alias: "Docs",
          shortUrl: "https://short.test/Docs",
          revision: 0,
          destination: expect.objectContaining({
            versionNumber: 1,
            url: "https://example.com/guide",
          }),
        }),
      ],
      nextCursor: null,
    });

    const detailResponse = await app.request(
      `https://management.test/api/internal/links/${created.link.id}`,
      { headers: { cookie: authentication.cookie } },
      env,
    );
    expect(detailResponse.status).toBe(200);
    expect(await detailResponse.json()).toEqual({
      ok: true,
      link: expect.objectContaining({
        id: created.link.id,
        alias: "Docs",
        destination: expect.objectContaining({ versionNumber: 1 }),
      }),
    });
  });

  it("edits a Link atomically and rejects a stale revision", async () => {
    const authentication = await loginAdministrator();
    const createResponse = await app.request(
      "https://management.test/api/internal/links",
      {
        method: "POST",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({
          alias: "Docs",
          title: "Documentation",
          destination: "https://example.com/v1",
        }),
      },
      env,
    );
    const created = (await createResponse.json()) as { link: { id: string } };

    const editResponse = await app.request(
      `https://management.test/api/internal/links/${created.link.id}`,
      {
        method: "PATCH",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({
          expectedRevision: 0,
          title: "Updated documentation",
          destination: "https://example.com/v2",
        }),
      },
      env,
    );
    expect(editResponse.status).toBe(200);
    expect(await editResponse.json()).toEqual({
      ok: true,
      changed: true,
      link: expect.objectContaining({
        revision: 1,
        title: "Updated documentation",
        destination: expect.objectContaining({
          versionNumber: 2,
          url: "https://example.com/v2",
        }),
      }),
    });

    const staleResponse = await app.request(
      `https://management.test/api/internal/links/${created.link.id}`,
      {
        method: "PATCH",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({
          expectedRevision: 0,
          title: "Updated documentation",
        }),
      },
      env,
    );
    expect(staleResponse.status).toBe(409);
    expect(await staleResponse.json()).toEqual({
      ok: false,
      kind: "link-conflict",
      details: { revision: 1 },
    });
  });

  it("executes explicit Link state commands with revision guards", async () => {
    const authentication = await loginAdministrator();
    const createResponse = await app.request(
      "https://management.test/api/internal/links",
      {
        method: "POST",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({
          alias: "Docs",
          title: "Documentation",
          destination: "https://example.com",
        }),
      },
      env,
    );
    const created = (await createResponse.json()) as { link: { id: string } };
    const commands = [
      ["disable", 0, "disabled", 1],
      ["archive", 1, "archived", 2],
      ["restore", 2, "disabled", 3],
      ["activate", 3, "active", 4],
    ] as const;

    await buildSequentialFixtures(
      commands,
      async ([command, expectedRevision, state, revision]) => {
        const response = await app.request(
          `https://management.test/api/internal/links/${created.link.id}/${command}`,
          {
            method: "POST",
            headers: authenticatedHeaders(authentication),
            body: JSON.stringify({ expectedRevision }),
          },
          env,
        );
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({
          ok: true,
          changed: true,
          link: expect.objectContaining({ state, revision }),
        });
        return response;
      },
    );
  });

  it("pages Destination Version history newest first for an Archived Link", async () => {
    const authentication = await loginAdministrator();
    const createResponse = await app.request(
      "https://management.test/api/internal/links",
      {
        method: "POST",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({
          alias: "Docs",
          title: "Documentation",
          destination: "https://example.com/v1",
        }),
      },
      env,
    );
    const created = (await createResponse.json()) as { link: { id: string } };
    await buildSequentialFixtures(
      [
        [0, "https://example.com/v2"],
        [1, "https://example.com/v3"],
      ] as const,
      async ([expectedRevision, destination]) =>
        await app.request(
          `https://management.test/api/internal/links/${created.link.id}`,
          {
            method: "PATCH",
            headers: authenticatedHeaders(authentication),
            body: JSON.stringify({ expectedRevision, destination }),
          },
          env,
        ),
    );
    await app.request(
      `https://management.test/api/internal/links/${created.link.id}/archive`,
      {
        method: "POST",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({ expectedRevision: 2 }),
      },
      env,
    );

    const firstResponse = await app.request(
      `https://management.test/api/internal/links/${created.link.id}/destination-versions?limit=2`,
      { headers: { cookie: authentication.cookie } },
      env,
    );
    expect(firstResponse.status).toBe(200);
    const first = (await firstResponse.json()) as {
      items: Array<{ versionNumber: number; current: boolean; url: string }>;
      nextCursor: string | null;
    };
    expect(first).toEqual({
      ok: true,
      items: [
        expect.objectContaining({
          versionNumber: 3,
          current: true,
          url: "https://example.com/v3",
        }),
        expect.objectContaining({
          versionNumber: 2,
          current: false,
          url: "https://example.com/v2",
        }),
      ],
      nextCursor: expect.any(String),
    });
    if (first.nextCursor === null) throw new Error("expected a history cursor");

    const secondResponse = await app.request(
      `https://management.test/api/internal/links/${created.link.id}/destination-versions?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`,
      { headers: { cookie: authentication.cookie } },
      env,
    );
    expect(await secondResponse.json()).toEqual({
      ok: true,
      items: [
        expect.objectContaining({
          versionNumber: 1,
          current: false,
          url: "https://example.com/v1",
        }),
      ],
      nextCursor: null,
    });
  });

  it("permanently deletes an Archived Link and manages its Reserved Alias", async () => {
    const authentication = await loginAdministrator();
    const createResponse = await app.request(
      "https://management.test/api/internal/links",
      {
        method: "POST",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({
          alias: "Docs",
          title: "Documentation",
          destination: "https://example.com",
        }),
      },
      env,
    );
    const created = (await createResponse.json()) as { link: { id: string } };
    await app.request(
      `https://management.test/api/internal/links/${created.link.id}/archive`,
      {
        method: "POST",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({ expectedRevision: 0 }),
      },
      env,
    );

    const mismatchResponse = await app.request(
      `https://management.test/api/internal/links/${created.link.id}/permanently-delete`,
      {
        method: "POST",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({
          expectedRevision: 1,
          confirmationAlias: "docs",
        }),
      },
      env,
    );
    expect(mismatchResponse.status).toBe(400);
    expect(await mismatchResponse.json()).toEqual({
      ok: false,
      kind: "confirmation-mismatch",
      details: {},
    });

    const deleteResponse = await app.request(
      `https://management.test/api/internal/links/${created.link.id}/permanently-delete`,
      {
        method: "POST",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({
          expectedRevision: 1,
          confirmationAlias: "Docs",
        }),
      },
      env,
    );
    expect(deleteResponse.status).toBe(200);
    expect(await deleteResponse.json()).toEqual({
      ok: true,
      reservedAlias: {
        alias: "Docs",
        shortUrl: "https://short.test/Docs",
        deletedLinkId: created.link.id,
        reservedAt: expect.any(String),
      },
    });

    const listResponse = await app.request(
      "https://management.test/api/internal/reserved-aliases?search=docs",
      { headers: { cookie: authentication.cookie } },
      env,
    );
    expect(await listResponse.json()).toEqual({
      ok: true,
      items: [
        expect.objectContaining({
          alias: "Docs",
          shortUrl: "https://short.test/Docs",
          deletedLinkId: created.link.id,
        }),
      ],
      nextCursor: null,
    });

    const releaseResponse = await app.request(
      "https://management.test/api/internal/reserved-aliases/Docs/release",
      {
        method: "POST",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({ confirmationAlias: "Docs" }),
      },
      env,
    );
    expect(releaseResponse.status).toBe(204);
    expect(await releaseResponse.text()).toBe("");
  });

  it("requires recent authentication before permanent Link deletion", async () => {
    const authentication = await loginAdministrator();
    const createResponse = await app.request(
      "https://management.test/api/internal/links",
      {
        method: "POST",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({
          alias: "Docs",
          title: "Documentation",
          destination: "https://example.com",
        }),
      },
      env,
    );
    const created = (await createResponse.json()) as { link: { id: string } };
    await app.request(
      `https://management.test/api/internal/links/${created.link.id}/archive`,
      {
        method: "POST",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({ expectedRevision: 0 }),
      },
      env,
    );
    const staleAuthentication = Date.now() - 11 * 60 * 1_000;
    await env.DB.prepare("UPDATE sessions SET created_at = ?, recent_authentication_at = ?")
      .bind(staleAuthentication, staleAuthentication)
      .run();

    const response = await app.request(
      `https://management.test/api/internal/links/${created.link.id}/permanently-delete`,
      {
        method: "POST",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({
          expectedRevision: 1,
          confirmationAlias: "Docs",
        }),
      },
      env,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      ok: false,
      kind: "reauthentication-required",
      details: {},
    });
  });

  it("reports an Alias collision as a conflict", async () => {
    const authentication = await loginAdministrator();
    const request = {
      method: "POST",
      headers: authenticatedHeaders(authentication),
      body: JSON.stringify({
        alias: "Taken",
        title: "Documentation",
        destination: "https://example.com/guide",
      }),
    };
    const firstResponse = await app.request(
      "https://management.test/api/internal/links",
      request,
      env,
    );
    expect(firstResponse.status).toBe(201);

    const response = await app.request("https://management.test/api/internal/links", request, env);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      ok: false,
      kind: "alias-in-use",
      details: { alias: "Taken" },
    });
  });

  it("rejects a request that does not match the strict transport schema", async () => {
    const authentication = await loginAdministrator();
    const response = await app.request(
      "https://management.test/api/internal/links",
      {
        method: "POST",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({
          alias: "Docs",
          destination: "https://example.com/guide",
          unexpected: true,
        }),
      },
      env,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      kind: "invalid-request",
      details: {},
    });
  });

  it("rejects unknown Link query parameters", async () => {
    const authentication = await loginAdministrator();
    const response = await app.request(
      "https://management.test/api/internal/links?stats=archived",
      { headers: { cookie: authentication.cookie } },
      env,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      kind: "invalid-query",
      details: {},
    });
  });

  it("rejects an empty Link edit", async () => {
    const authentication = await loginAdministrator();
    const response = await app.request(
      "https://management.test/api/internal/links/missing",
      {
        method: "PATCH",
        headers: authenticatedHeaders(authentication),
        body: JSON.stringify({ expectedRevision: 0 }),
      },
      env,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      kind: "invalid-request",
      details: {},
    });
  });
});

type TestAuthentication = Readonly<{ cookie: string; csrfToken: string }>;

async function loginAdministrator(): Promise<TestAuthentication> {
  const identity = createIdentity({ db: env.DB });
  await identity.writeInitialSetup({
    displayEmail: "Admin@Example.com",
    token: "setup-secret",
    expiresAt: new Date(Date.now() + 30 * 60 * 1_000),
  });
  await identity.completeInitialSetup({
    token: "setup-secret",
    password: "violet glacier orbits quietly 729",
  });
  return loginUser("admin@example.com", "violet glacier orbits quietly 729");
}

async function loginUser(email: string, password: string): Promise<TestAuthentication> {
  const response = await app.request(
    "https://management.test/api/internal/auth/login",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://management.test",
      },
      body: JSON.stringify({
        email,
        password,
      }),
    },
    env,
  );
  const body = (await response.json()) as { csrfToken: string };
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!cookie) {
    throw new Error("Expected login to set a Session cookie");
  }
  return { cookie, csrfToken: body.csrfToken };
}

function authenticatedHeaders(authentication: TestAuthentication) {
  return {
    "content-type": "application/json",
    cookie: authentication.cookie,
    origin: "https://management.test",
    "x-csrf-token": authentication.csrfToken,
  };
}
