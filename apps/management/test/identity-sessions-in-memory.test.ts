import { describe, expect, it } from "vitest";

import { createInMemorySessionPersistence } from "../src/worker/modules/identity/adapters/in-memory/sessions";
import { createSessions } from "../src/worker/modules/identity/application/sessions";
import { createPasswordVerifier } from "../src/worker/modules/identity/application/passwords";

describe("Identity Sessions with in-memory persistence", () => {
  it("logs in, authenticates mutations, and logs out through the capability interface", async () => {
    const verifier = await createPasswordVerifier("violet glacier orbits quietly 729");
    if (!verifier) throw new Error("Expected a valid test password");
    let nextToken = 0;
    const sessions = createSessions(
      createInMemorySessionPersistence([
        {
          id: "user",
          email: "User@Example.com",
          role: "member",
          state: "active",
          verifier,
        },
      ]),
      {
        now: () => new Date("2026-07-26T00:00:00.000Z"),
        randomId: () => "session-id",
        randomToken: () => `token-${++nextToken}`,
      },
    );

    const login = await sessions.login({
      email: " user@example.COM ",
      password: "violet glacier orbits quietly 729",
    });
    expect(login).toMatchObject({ ok: true, kind: "session" });
    if (!login.ok) throw new Error("Expected login to succeed");

    await expect(
      sessions.authenticateRequest(login.session.token, login.session.csrfToken),
    ).resolves.toMatchObject({
      ok: true,
      kind: "user",
      recentlyAuthenticated: true,
    });
    await expect(sessions.authenticateRequest(login.session.token, "wrong-csrf")).resolves.toEqual({
      ok: false,
      kind: "invalid-csrf-token",
    });

    await sessions.logout(login.session.token);
    await expect(sessions.authenticate(login.session.token)).resolves.toEqual({
      ok: false,
      kind: "invalid-credentials",
    });
  });

  it("revokes every Session after a password change", async () => {
    const verifier = await createPasswordVerifier("violet glacier orbits quietly 729");
    if (!verifier) throw new Error("Expected a valid test password");
    const sessions = createSessions(
      createInMemorySessionPersistence([
        {
          id: "user",
          email: "user@example.com",
          role: "member",
          state: "active",
          verifier,
        },
      ]),
      {
        now: () => new Date("2026-07-26T00:00:00.000Z"),
        randomId: () => "generated-id",
        randomToken: () => crypto.randomUUID(),
      },
    );
    const login = await sessions.login({
      email: "user@example.com",
      password: "violet glacier orbits quietly 729",
    });
    if (!login.ok) throw new Error("Expected login to succeed");

    await expect(
      sessions.changePassword({
        userId: "user",
        currentPassword: "violet glacier orbits quietly 729",
        password: "amber planets gather softly 913",
      }),
    ).resolves.toEqual({ ok: true, kind: "password-changed" });
    await expect(sessions.authenticate(login.session.token)).resolves.toEqual({
      ok: false,
      kind: "invalid-credentials",
    });
  });
});
