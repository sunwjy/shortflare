import { env } from "cloudflare:workers";
import { Buffer } from "node:buffer";
import { scrypt } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import { createIdentity } from "../../src/worker/modules/identity";
import { resetIdentityDatabase } from "../support/management-database";

const now = new Date("2026-07-26T00:00:00.000Z");

describe("Identity setup and Sessions", () => {
  beforeEach(resetIdentityDatabase);

  it("consumes Setup Token once to activate the initial Administrator", async () => {
    const identity = createIdentity({
      db: env.DB,
      now: () => now,
      randomId: () => "generated-id",
    });
    await identity.initialSetup.writeInitialSetup({
      displayEmail: "Admin@Example.com",
      token: "setup-secret",
      expiresAt: new Date(now.getTime() + 30 * 60 * 1_000),
    });

    const result = await identity.initialSetup.completeInitialSetup({
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
      identity.initialSetup.completeInitialSetup({
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
    await identity.initialSetup.writeInitialSetup({
      displayEmail: "Admin@Example.com",
      token: "setup-secret",
      expiresAt: new Date(now.getTime() + 30 * 60 * 1_000),
    });
    await identity.initialSetup.completeInitialSetup({
      token: "setup-secret",
      password: "violet glacier orbits quietly 729",
    });

    const result = await identity.sessions.login({
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
    await expect(identity.sessions.authenticate(result.session.token)).resolves.toEqual({
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
    await identity.initialSetup.writeInitialSetup({
      displayEmail: "Admin@Example.com",
      token: "setup-secret",
      expiresAt: new Date(now.getTime() + 30 * 60 * 1_000),
    });
    await identity.initialSetup.completeInitialSetup({
      token: "setup-secret",
      password: "violet glacier orbits quietly 729",
    });
    const login = await identity.sessions.login({
      email: "admin@example.com",
      password: "violet glacier orbits quietly 729",
    });
    if (!login.ok) {
      throw new Error("Expected login to succeed");
    }
    const beforeRead = await readSessionTimes();

    const opened = await identity.sessions.openSession(login.session.token);

    expect(opened).toMatchObject({
      ok: true,
      session: { csrfToken: login.session.csrfToken },
    });
    await expect(readSessionTimes()).resolves.toEqual(beforeRead);

    currentTime = new Date(now.getTime() + 60 * 60 * 1_000);
    await expect(
      identity.sessions.authenticateRequest(login.session.token, login.session.csrfToken),
    ).resolves.toMatchObject({ ok: true, kind: "user" });
    const afterFirstMutation = await readSessionTimes();
    expect(afterFirstMutation.lastSeenAt).toBe(currentTime.getTime());

    currentTime = new Date(now.getTime() + 90 * 60 * 1_000);
    await expect(
      identity.sessions.authenticateRequest(login.session.token, login.session.csrfToken),
    ).resolves.toMatchObject({ ok: true, kind: "user" });
    await expect(readSessionTimes()).resolves.toEqual(afterFirstMutation);

    currentTime = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000 + 30 * 60 * 1_000);
    await expect(identity.sessions.authenticate(login.session.token)).resolves.toMatchObject({
      ok: true,
      kind: "user",
    });
  });

  it("rehashes a whitelisted legacy scrypt verifier after successful login", async () => {
    const identity = createIdentity({ db: env.DB, now: () => now });
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
    const legacyVerifier = await createLegacyVerifier("violet glacier orbits quietly 729");
    await env.DB.prepare("UPDATE credentials SET verifier = ? WHERE user_id = ?")
      .bind(legacyVerifier, setup.user.id)
      .run();

    await expect(
      identity.sessions.login({
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
          identity.invitations.issueInvitation({
            actorId: "administrator",
            email,
            role: "member",
          }),
        ).resolves.toEqual({ ok: false, kind: "invalid-email" }),
      ),
    );
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
