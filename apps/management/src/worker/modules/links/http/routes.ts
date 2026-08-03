import { createManagementHono } from "../../../transport/factory";
import type { LinksHttpDependencies } from "./dependencies";
import { createLinkResourceRoutes } from "./link-routes";
import { createReservedAliasRoutes } from "./reserved-alias-routes";

export function createLinksHttpRoutes(dependencies: LinksHttpDependencies) {
  return createManagementHono()
    .route("/", createLinkResourceRoutes(dependencies))
    .route("/", createReservedAliasRoutes(dependencies));
}
