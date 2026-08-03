import { env } from "cloudflare:workers";

import { app } from "../../src/worker/index";
import { createIdentity } from "../../src/worker/modules/identity";

export type TestAuthentication = Readonly<{ cookie: string; csrfToken: string }>;

export async function loginAdministrator(): Promise<TestAuthentication> {
  const identity = createIdentity({ db: env.DB });
  await identity.initialSetup.writeInitialSetup({
    displayEmail: "Admin@Example.com",
    token: "setup-secret",
    expiresAt: new Date(Date.now() + 30 * 60 * 1_000),
  });
  await identity.initialSetup.completeInitialSetup({
    token: "setup-secret",
    password: "violet glacier orbits quietly 729",
  });
  return loginUser("admin@example.com", "violet glacier orbits quietly 729");
}

export async function loginUser(email: string, password: string): Promise<TestAuthentication> {
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

export function authenticatedHeaders(authentication: TestAuthentication) {
  return {
    "content-type": "application/json",
    cookie: authentication.cookie,
    origin: "https://management.test",
    "x-csrf-token": authentication.csrfToken,
  };
}
