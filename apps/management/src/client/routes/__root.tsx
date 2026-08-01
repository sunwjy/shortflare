import { createRootRouteWithContext } from "@tanstack/react-router";

import { AppShell } from "../app-shell";
import type { ManagementRouterContext } from "../management-router-context";

export const Route = createRootRouteWithContext<ManagementRouterContext>()({
  component: AppShell,
});
