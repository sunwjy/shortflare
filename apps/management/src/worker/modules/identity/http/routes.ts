import type { ManagementDependencies } from "../../../dependencies";
import { createManagementHono } from "../../../transport/factory";
import { createAuthRoutes } from "./auth-routes";
import { createUserRoutes } from "./user-routes";

type IdentityHttpDependencies = Pick<
  ManagementDependencies,
  "createIdentity" | "createRequestAuthentication" | "createRequestRateLimits" | "hasCapability"
>;

export function createIdentityHttpRoutes(dependencies: IdentityHttpDependencies) {
  return createManagementHono()
    .route("/auth", createAuthRoutes(dependencies))
    .route("/users", createUserRoutes(dependencies));
}
