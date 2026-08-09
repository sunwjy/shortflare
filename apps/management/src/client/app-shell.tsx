import { getRouteApi, Link, Outlet } from "@tanstack/react-router";
import { ChartNoAxesCombined, Link2, ListChecks, LogOut, Menu, Shield, Users } from "lucide-react";
import { useState } from "react";

import { noContentRequest } from "./api";
import { AppDialog } from "./components/app-dialog";
import { ThemeField } from "./components/theme-field";
import { Button } from "./components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { useTheme } from "./theme-context";
import type { Session } from "./types";

const rootApi = getRouteApi("__root__");
const navigationLinkClass =
  "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground no-underline hover:bg-sidebar-accent hover:text-sidebar-accent-foreground aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground";

export function AppShell() {
  const { session, onSession } = rootApi.useRouteContext();
  const { theme, setTheme } = useTheme();
  const [mobileMenu, setMobileMenu] = useState(false);
  const securityMenuLink = <Link to="/security" />;

  async function logout() {
    await noContentRequest("/api/internal/auth/logout", {
      method: "POST",
      csrfToken: session.csrfToken,
      body: {},
    }).catch(() => undefined);
    onSession(undefined);
  }

  return (
    <div className="min-h-screen bg-background text-foreground md:grid md:grid-cols-[13.5rem_minmax(0,1fr)]">
      <aside className="fixed inset-x-0 top-0 z-30 flex h-16 items-center justify-between border-b bg-sidebar px-4 text-sidebar-foreground md:sticky md:inset-auto md:top-0 md:h-screen md:flex-col md:items-stretch md:border-r md:border-b-0 md:py-5">
        <a
          className="flex items-center gap-3 text-sidebar-foreground no-underline md:mb-8 md:px-2"
          href="/links"
          aria-label="Shortflare home"
        >
          <span
            className="grid size-8 place-items-center rounded-lg bg-sidebar-primary font-bold text-sidebar-primary-foreground"
            aria-hidden="true"
          >
            S
          </span>
          <strong>Shortflare</strong>
        </a>
        <nav className="hidden gap-1 md:grid" aria-label="Primary navigation">
          <Link
            className={navigationLinkClass}
            to="/links"
            search={{ state: [] }}
            activeProps={{ "aria-current": "page" }}
          >
            <Link2 aria-hidden="true" size={20} strokeWidth={1.75} />
            Links
          </Link>
          <Link
            className={navigationLinkClass}
            to="/analytics"
            activeProps={{ "aria-current": "page" }}
          >
            <ChartNoAxesCombined aria-hidden="true" size={20} strokeWidth={1.75} />
            Analytics
          </Link>
          {session.user.role === "administrator" && <AdministratorNavigation />}
          <Link
            className={navigationLinkClass}
            to="/security"
            activeProps={{ "aria-current": "page" }}
          >
            <Shield aria-hidden="true" size={20} strokeWidth={1.75} />
            Security
          </Link>
        </nav>
        <div className="mt-auto hidden gap-3 border-t pt-4 md:grid">
          <ThemeField className="px-2" theme={theme} onTheme={setTheme} />
          <DropdownMenu>
            <DropdownMenuTrigger className="grid w-full cursor-pointer gap-1 rounded-lg px-2 py-2 text-left hover:bg-sidebar-accent">
              <span>{session.user.email}</span>
              <small className="text-xs text-muted-foreground">
                {roleLabel(session.user.role)}
              </small>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="min-w-64 p-2">
              <DropdownMenuLabel>{session.user.email}</DropdownMenuLabel>
              <DropdownMenuItem render={securityMenuLink}>
                <Shield aria-hidden="true" size={18} strokeWidth={1.75} />
                Security
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void logout()}>
                <LogOut aria-hidden="true" size={18} strokeWidth={1.75} />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Button
          className="md:hidden"
          variant="ghost"
          size="icon"
          aria-label="Open navigation"
          onClick={() => setMobileMenu(true)}
        >
          <Menu aria-hidden="true" size={22} strokeWidth={1.75} />
        </Button>
      </aside>
      <main className="mx-auto w-full max-w-7xl px-4 pt-24 pb-6 md:px-[clamp(1.25rem,4vw,4rem)] md:py-12">
        <Outlet />
      </main>
      <AppDialog
        open={mobileMenu}
        onOpenChange={setMobileMenu}
        title="Navigation"
        description={`${session.user.email} · ${roleLabel(session.user.role)}`}
      >
        <nav className="grid gap-1" aria-label="Mobile navigation">
          <Link
            className={navigationLinkClass}
            to="/links"
            search={{ state: [] }}
            onClick={() => setMobileMenu(false)}
          >
            <Link2 aria-hidden="true" size={20} strokeWidth={1.75} />
            Links
          </Link>
          <Link
            className={navigationLinkClass}
            to="/analytics"
            onClick={() => setMobileMenu(false)}
          >
            <ChartNoAxesCombined aria-hidden="true" size={20} strokeWidth={1.75} />
            Analytics
          </Link>
          {session.user.role === "administrator" && (
            <AdministratorNavigation onNavigate={() => setMobileMenu(false)} />
          )}
          <Link className={navigationLinkClass} to="/security" onClick={() => setMobileMenu(false)}>
            <Shield aria-hidden="true" size={20} strokeWidth={1.75} />
            Security
          </Link>
          <ThemeField className="px-3 py-2" theme={theme} onTheme={setTheme} />
          <Button className="justify-start" variant="ghost" onClick={() => void logout()}>
            <LogOut aria-hidden="true" size={18} strokeWidth={1.75} />
            Log out
          </Button>
        </nav>
      </AppDialog>
    </div>
  );
}

function AdministratorNavigation({ onNavigate }: Readonly<{ onNavigate?: () => void }>) {
  return (
    <>
      <Link
        className={navigationLinkClass}
        to="/users"
        activeProps={{ "aria-current": "page" }}
        onClick={onNavigate}
      >
        <Users aria-hidden="true" size={20} strokeWidth={1.75} />
        Users
      </Link>
      <Link
        className={navigationLinkClass}
        to="/audit"
        activeProps={{ "aria-current": "page" }}
        onClick={onNavigate}
      >
        <ListChecks aria-hidden="true" size={20} strokeWidth={1.75} />
        Audit
      </Link>
    </>
  );
}

function roleLabel(role: Session["user"]["role"]) {
  return {
    administrator: "Administrator",
    member: "Member",
    viewer: "Viewer",
  }[role];
}
