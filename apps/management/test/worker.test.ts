import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { app } from "../src/worker/index";
import { createIdentity } from "../src/worker/identity";

describe("management worker", () => {
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM audit_events"),
      env.DB.prepare("DELETE FROM sessions"),
      env.DB.prepare("DELETE FROM credentials"),
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
    expect(await response.json()).toEqual({ ok: false, kind: "invalid-csrf-token" });
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
    expect(await response.json()).toEqual({ ok: false, kind: "unauthenticated" });
  });

  it("lets an Administrator invite a Viewer whose Link mutation is forbidden", async () => {
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
    expect(await response.json()).toEqual({ ok: false, kind: "forbidden" });
  });

  it("refreshes CSRF through the current Session and logs out that Session", async () => {
    const authentication = await loginAdministrator();
    const sessionResponse = await app.request(
      "https://management.test/api/internal/auth/session",
      { headers: { cookie: authentication.cookie } },
      env,
    );
    expect(sessionResponse.status).toBe(200);
    const sessionBody = (await sessionResponse.json()) as { csrfToken: string };

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
    expect(await response.json()).toMatchObject({
      ok: true,
      kind: "link",
      link: {
        alias: "Docs",
        title: "Documentation",
        state: "active",
      },
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
      alias: "Taken",
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
