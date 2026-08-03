import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { app } from "../../src/worker/index";
import { createIdentity } from "../../src/worker/modules/identity";
import { resetManagementDatabase } from "../support/management-database";
import {
  authenticatedHeaders,
  loginAdministrator,
  loginUser,
} from "../support/worker-authentication";

describe("management health and authentication", () => {
  beforeEach(resetManagementDatabase);

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
    await createIdentity({ db: env.DB }).initialSetup.writeInitialSetup({
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
    const invitation = await identity.invitations.issueInvitation({
      actorId: administratorRecord.id,
      email: "Member@Example.com",
      role: "member",
    });
    if (!invitation.ok) throw new Error("Expected Member invitation");
    await identity.invitations.acceptInvitation({
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
});
