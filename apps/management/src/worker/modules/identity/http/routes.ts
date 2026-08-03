import { Hono } from "hono";

import type { ManagementDependencies } from "../../../dependencies";
import type { ManagementEnvironment } from "../../../environment";
import { createAuthRoutes } from "./auth-routes";
import { createUserRoutes } from "./user-routes";

type IdentityHttpDependencies = Pick<
  ManagementDependencies,
  "createIdentity" | "createRequestAuthentication" | "hasCapability"
>;

export function createIdentityHttpRoutes(dependencies: IdentityHttpDependencies) {
  return new Hono<ManagementEnvironment>()
    .route("/auth", createAuthRoutes(dependencies))
    .route("/users", createUserRoutes(dependencies));
}
