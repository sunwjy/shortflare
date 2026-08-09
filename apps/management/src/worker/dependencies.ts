import type { Analytics } from "@shortflare/analytics";
import type { Links } from "@shortflare/links";

import type { Capability } from "./access-control";
import type { ManagementBindings } from "./environment";
import type { AuditEvents } from "./modules/audit";
import type { Identity, User } from "./modules/identity";
import type { RequestAuthentication } from "./transport/request-authentication";
import type { RequestRateLimits } from "./transport/request-rate-limits";

export type ManagementDependencies = Readonly<{
  createAnalytics(bindings: ManagementBindings): Analytics;
  createAuditEvents(bindings: ManagementBindings): AuditEvents;
  createIdentity(bindings: ManagementBindings): Identity;
  createLinks(bindings: ManagementBindings): Links;
  createRequestAuthentication(bindings: ManagementBindings): RequestAuthentication;
  createRequestRateLimits(bindings: ManagementBindings): RequestRateLimits;
  hasCapability(user: User, capability: Capability): boolean;
}>;
