import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";

import { AppShell } from "./app-shell";
import {
  CreateLinkPanel,
  LinkDetailPanel,
  LinksPage,
  parseLinkStates,
  type LinkSearch,
} from "./features/links";
import { SecurityPage } from "./features/security/security-page";
import { UsersPage } from "./features/users/users-page";
import type { Theme } from "./theme";
import type { Session } from "./types";

export type ManagementRouterContext = Readonly<{
  session: Session;
  onSession: (session: Session | undefined) => void;
  queryClient: QueryClient;
  theme: Theme;
  setTheme: (theme: Theme) => void;
}>;

const rootRoute = createRootRouteWithContext<ManagementRouterContext>()({
  component: AppShell,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/links", search: { state: [] } });
  },
});

const linksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "links",
  validateSearch: (raw): LinkSearch => ({
    ...(typeof raw.search === "string" && raw.search.trim() ? { search: raw.search.trim() } : {}),
    state: parseLinkStates(raw.state),
  }),
  component: LinksPage,
});

const createLinkRoute = createRoute({
  getParentRoute: () => linksRoute,
  path: "new",
  beforeLoad: ({ context }) => {
    if (context.session.user.role === "viewer") {
      throw redirect({ to: "/links", search: { state: [] } });
    }
  },
  component: CreateLinkPanel,
});

const linkDetailRoute = createRoute({
  getParentRoute: () => linksRoute,
  path: "$linkId",
  component: LinkDetailPanel,
});

const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "users",
  component: UsersPage,
});

const securityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "security",
  component: SecurityPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  linksRoute.addChildren([createLinkRoute, linkDetailRoute]),
  usersRoute,
  securityRoute,
]);

export function createManagementRouter() {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
    context: undefined as never,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createManagementRouter>;
  }
}
