import { useEffect, useMemo, useState } from "react";

import { apiRequest } from "./api";
import { LoginScreen, TokenPasswordScreen } from "./auth-screens";
import { ManagementApp } from "./management-app";
import { applyTheme, readTheme, type Theme } from "./theme";
import type { Session, TokenRoute, User } from "./types";

export function App() {
  const tokenRoute = useMemo(readTokenRoute, []);
  const [session, setSession] = useState<Session>();
  const [loading, setLoading] = useState(true);
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (tokenRoute) {
      setLoading(false);
      return;
    }
    void apiRequest<{ user: User; csrfToken: string }>("/api/internal/auth/session")
      .then((response) => {
        setSession({ user: response.user, csrfToken: response.csrfToken });
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [tokenRoute]);

  if (tokenRoute) {
    return <TokenPasswordScreen route={tokenRoute} theme={theme} onTheme={setTheme} />;
  }
  if (loading) {
    return (
      <main className="auth-shell" aria-busy="true">
        <p>Loading Shortflare…</p>
      </main>
    );
  }
  if (!session) {
    return <LoginScreen onLogin={setSession} theme={theme} onTheme={setTheme} />;
  }
  return (
    <ManagementApp session={session} onSession={setSession} theme={theme} onTheme={setTheme} />
  );
}

function readTokenRoute(): TokenRoute | undefined {
  const token = new URLSearchParams(location.hash.slice(1)).get("token");
  const routes: Record<string, Omit<TokenRoute, "token">> = {
    "/setup": { kind: "setup", endpoint: "/api/internal/auth/setup" },
    "/accept-invitation": {
      kind: "invitation",
      endpoint: "/api/internal/auth/invitations/accept",
    },
    "/reset-password": {
      kind: "reset",
      endpoint: "/api/internal/auth/password-resets/use",
    },
    "/operator-recovery": {
      kind: "recovery",
      endpoint: "/api/internal/auth/operator-recovery",
    },
  };
  const route = routes[location.pathname];
  if (!route || !token) return undefined;
  history.replaceState(null, "", location.pathname);
  return { ...route, token };
}
