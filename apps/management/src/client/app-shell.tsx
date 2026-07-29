import { getRouteApi, Link, Outlet } from "@tanstack/react-router";
import { Link2, LogOut, Menu, Shield, Users } from "lucide-react";
import { useState } from "react";

import { noContentRequest } from "./api";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import type { Theme } from "./theme";
import type { Session } from "./types";

const rootApi = getRouteApi("__root__");

export function AppShell() {
  const { session, onSession, theme, setTheme } = rootApi.useRouteContext();
  const [mobileMenu, setMobileMenu] = useState(false);

  async function logout() {
    await noContentRequest("/api/internal/auth/logout", {
      method: "POST",
      csrfToken: session.csrfToken,
      body: {},
    }).catch(() => undefined);
    onSession(undefined);
  }

  return (
    <div className="app-shell">
      <aside className="navigation-rail">
        <a className="wordmark" href="/links" aria-label="Shortflare home">
          <span aria-hidden="true">S</span>
          <strong>Shortflare</strong>
        </a>
        <nav aria-label="Primary navigation">
          <Link to="/links" search={{ state: [] }} activeProps={{ "aria-current": "page" }}>
            <Link2 aria-hidden="true" size={20} strokeWidth={1.75} />
            Links
          </Link>
          {session.user.role === "administrator" && (
            <Link to="/users" activeProps={{ "aria-current": "page" }}>
              <Users aria-hidden="true" size={20} strokeWidth={1.75} />
              Users
            </Link>
          )}
        </nav>
        <div className="user-summary">
          <details className="user-menu">
            <summary>
              <span>{session.user.email}</span>
              <small>{roleLabel(session.user.role)}</small>
            </summary>
            <div className="user-menu__popup">
              <Link to="/security" activeProps={{ "aria-current": "page" }}>
                <Shield aria-hidden="true" size={18} strokeWidth={1.75} />
                Security
              </Link>
              <ThemeField theme={theme} onTheme={setTheme} />
              <Button variant="quiet" onClick={() => void logout()}>
                <LogOut aria-hidden="true" size={18} strokeWidth={1.75} />
                Log out
              </Button>
            </div>
          </details>
        </div>
        <Button
          className="mobile-menu-trigger"
          variant="quiet"
          size="icon"
          aria-label="Open navigation"
          onClick={() => setMobileMenu(true)}
        >
          <Menu aria-hidden="true" size={22} strokeWidth={1.75} />
        </Button>
      </aside>
      <main className="work-area">
        <Outlet />
      </main>
      <Dialog
        open={mobileMenu}
        onOpenChange={setMobileMenu}
        title="Navigation"
        description={`${session.user.email} · ${roleLabel(session.user.role)}`}
      >
        <nav className="mobile-navigation" aria-label="Mobile navigation">
          <Link to="/links" search={{ state: [] }} onClick={() => setMobileMenu(false)}>
            <Link2 aria-hidden="true" size={20} strokeWidth={1.75} />
            Links
          </Link>
          {session.user.role === "administrator" && (
            <Link to="/users" onClick={() => setMobileMenu(false)}>
              <Users aria-hidden="true" size={20} strokeWidth={1.75} />
              Users
            </Link>
          )}
          <Link to="/security" onClick={() => setMobileMenu(false)}>
            <Shield aria-hidden="true" size={20} strokeWidth={1.75} />
            Security
          </Link>
          <ThemeField theme={theme} onTheme={setTheme} />
          <Button variant="quiet" onClick={() => void logout()}>
            <LogOut aria-hidden="true" size={18} strokeWidth={1.75} />
            Log out
          </Button>
        </nav>
      </Dialog>
    </div>
  );
}

function ThemeField({
  theme,
  onTheme,
}: Readonly<{ theme: Theme; onTheme: (theme: Theme) => void }>) {
  return (
    <label className="theme-field">
      Theme
      <select
        aria-label="Theme"
        value={theme}
        onChange={(event) => onTheme(event.target.value as Theme)}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}

function roleLabel(role: Session["user"]["role"]) {
  return {
    administrator: "Administrator",
    member: "Member",
    viewer: "Viewer",
  }[role];
}
