import type { ManagementDependencies } from "../../../dependencies";

export type LinksHttpDependencies = Pick<
  ManagementDependencies,
  "createLinks" | "createRequestAuthentication" | "createRequestRateLimits" | "hasCapability"
>;
