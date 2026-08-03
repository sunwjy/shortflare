import { Hono } from "hono";

import type { ManagementEnvironment } from "../../../environment";
import type { LinksHttpDependencies } from "./dependencies";
import { createLinkResourceRoutes } from "./link-routes";
import { createReservedAliasRoutes } from "./reserved-alias-routes";

export function createLinksHttpRoutes(dependencies: LinksHttpDependencies) {
  return new Hono<ManagementEnvironment>()
    .route("/", createLinkResourceRoutes(dependencies))
    .route("/", createReservedAliasRoutes(dependencies));
}
