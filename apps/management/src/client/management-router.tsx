import { createRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";

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
