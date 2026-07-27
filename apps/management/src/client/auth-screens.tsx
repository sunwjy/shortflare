/* oxlint-disable react-perf/jsx-no-new-function-as-prop -- Authentication form handlers are intentionally local to each screen. */
import { type FormEvent, useState } from "react";

import { apiRequest, ApiError } from "./api";
import { Button } from "./components/ui/button";
import type { Session, TokenRoute, User } from "./types";

export function LoginScreen({ onLogin }: Readonly<{ onLogin: (session: Session) => void }>) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const response = await apiRequest<{ ok: true; user: User; csrfToken: string }>(
        "/api/internal/auth/login",
        { method: "POST", body: { email, password } },
      );
      onLogin({ user: response.user, csrfToken: response.csrfToken });
    } catch {
      setError("Email or password is invalid.");
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <p className="brand-label">Shortflare</p>
        <h1>Sign in</h1>
        <p>Manage Links on your private Instance.</p>
        <form onSubmit={submit}>
          <label>
            User Email
            <input
              required
              type="email"
              value={email}
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Password
            <input
              required
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error && <p className="field-error">{error}</p>}
          <Button type="submit" size="large">
            Sign in
          </Button>
        </form>
      </section>
    </main>
  );
}

export function TokenPasswordScreen({ route }: Readonly<{ route: TokenRoute }>) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [result, setResult] = useState("");
  const title = {
    setup: "Set up the initial Administrator",
    invitation: "Accept your Invitation",
    reset: "Choose a new password",
    recovery: "Recover Administrator access",
  }[route.kind];

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirmation) {
      setResult("Passwords do not match.");
      return;
    }
    try {
      await apiRequest(route.endpoint, {
        method: "POST",
        body: { token: route.token, password },
      });
      setResult("Password saved. You can now sign in.");
    } catch (error) {
      setResult(
        error instanceof ApiError && error.body.kind === "invalid-or-expired-token"
          ? "This one-time link is invalid or expired."
          : "The password could not be saved.",
      );
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <p className="brand-label">One-time link</p>
        <h1>{title}</h1>
        <p>Use 15–128 characters. Spaces and Unicode are welcome.</p>
        <form onSubmit={submit}>
          <label>
            New password
            <input
              required
              type="password"
              value={password}
              autoComplete="new-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label>
            Confirm password
            <input
              required
              type="password"
              value={confirmation}
              autoComplete="new-password"
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          {result && (
            <p className={result.startsWith("Password saved") ? "field-success" : "field-error"}>
              {result}
            </p>
          )}
          <Button type="submit" size="large">
            Save password
          </Button>
          <a className="text-link" href="/">
            Return to sign in
          </a>
        </form>
      </section>
    </main>
  );
}
