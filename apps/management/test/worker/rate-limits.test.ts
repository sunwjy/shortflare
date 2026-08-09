import type { Analytics } from "@shortflare/analytics";
import type { Links } from "@shortflare/links";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { ManagementDependencies } from "../../src/worker/dependencies";
import { createManagementApp } from "../../src/worker/app";
import { createIdentity } from "../../src/worker/modules/identity";
import type {
  RateLimitBudget,
  RequestRateLimits,
} from "../../src/worker/transport/request-rate-limits";

describe("Management request rate limits", () => {
  it("rejects Management traffic by source while leaving health available", async () => {
    const decisions: RateLimitDecision[] = [
      { budget: "management-source", key: "203.0.113.7", allowed: false },
    ];
    const app = createManagementApp(testDependencies(decisions));

    const health = await app.request("https://management.test/api/internal/health", {}, env);
    const blocked = await app.request(
      "https://management.test/api/internal/links",
      { headers: { "cf-connecting-ip": "203.0.113.7" } },
      env,
    );

    expect(health.status).toBe(200);
    await expectRateLimited(blocked);
    expect(decisions).toEqual([]);
  });

  it("normalizes the Login target before credential verification", async () => {
    const decisions: RateLimitDecision[] = [
      { budget: "management-source", key: "203.0.113.8", allowed: true },
      { budget: "credential-source", key: "203.0.113.8", allowed: true },
      { budget: "login-target", key: "admin@example.com", allowed: false },
    ];
    const app = createManagementApp(testDependencies(decisions));

    const response = await app.request(
      "https://management.test/api/internal/auth/login",
      {
        method: "POST",
        headers: {
          "cf-connecting-ip": "203.0.113.8",
          "content-type": "application/json",
          origin: "https://management.test",
        },
        body: JSON.stringify({
          email: "  Admin@Example.COM ",
          password: "violet glacier orbits quietly 729",
        }),
      },
      env,
    );

    await expectRateLimited(response);
    expect(decisions).toEqual([]);
  });

  it("limits an authenticated User before the requested capability runs", async () => {
    const decisions: RateLimitDecision[] = [
      { budget: "management-source", key: "203.0.113.9", allowed: true },
      { budget: "general-user", key: "user-1", allowed: false },
    ];
    const app = createManagementApp(testDependencies(decisions));

    const response = await app.request(
      "https://management.test/api/internal/links",
      {
        headers: {
          "cf-connecting-ip": "203.0.113.9",
          cookie: "__Host-shortflare_session=session",
        },
      },
      env,
    );

    await expectRateLimited(response);
    expect(decisions).toEqual([]);
  });

  it("applies the privileged Actor budget to User management", async () => {
    const decisions: RateLimitDecision[] = [
      { budget: "management-source", key: "203.0.113.10", allowed: true },
      { budget: "general-user", key: "user-1", allowed: true },
      { budget: "privileged-actor", key: "user-1", allowed: false },
    ];
    const app = createManagementApp(testDependencies(decisions));

    const response = await app.request(
      "https://management.test/api/internal/users/invitations",
      {
        method: "POST",
        headers: {
          "cf-connecting-ip": "203.0.113.10",
          "content-type": "application/json",
          cookie: "__Host-shortflare_session=session",
          origin: "https://management.test",
          "x-csrf-token": "csrf",
        },
        body: JSON.stringify({ email: "invitee@example.com", role: "member" }),
      },
      env,
    );

    await expectRateLimited(response);
    expect(decisions).toEqual([]);
  });
});

type RateLimitDecision = Readonly<{
  budget: RateLimitBudget;
  key: string;
  allowed: boolean;
}>;

function testDependencies(decisions: RateLimitDecision[]): ManagementDependencies {
  return {
    createAnalytics: () => unexpectedAnalytics(),
    createAuditEvents: () => {
      throw new Error("Rate limit rejections must not create Audit Events");
    },
    createIdentity: (bindings) => createIdentity({ db: bindings.DB }),
    createLinks: () => unexpectedLinks(),
    createRequestAuthentication: () => ({
      async authenticateSafe() {
        return {
          ok: true,
          user: {
            id: "user-1",
            email: "Admin@Example.com",
            role: "administrator",
            state: "active",
          },
        };
      },
      async authenticateMutation() {
        return {
          ok: true,
          user: {
            id: "user-1",
            email: "Admin@Example.com",
            role: "administrator",
            state: "active",
          },
          recentlyAuthenticated: true,
        };
      },
    }),
    createRequestRateLimits: () => decisionRateLimits(decisions),
    hasCapability: () => true,
  };
}

function decisionRateLimits(decisions: RateLimitDecision[]): RequestRateLimits {
  return {
    async consume(budget, key) {
      const decision = decisions.shift();
      expect({ budget, key }).toEqual(
        decision === undefined ? undefined : { budget: decision.budget, key: decision.key },
      );
      return decision?.allowed ?? false;
    },
  };
}

function unexpectedAnalytics(): Analytics {
  throw new Error("Rate-limited request must not create Analytics");
}

function unexpectedLinks(): Links {
  throw new Error("Rate-limited request must not create Links");
}

async function expectRateLimited(response: Response) {
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("60");
  expect(await response.json()).toEqual({ ok: false, kind: "rate-limited" });
}
