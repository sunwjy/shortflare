import type { Analytics } from "@shortflare/analytics";
import type { Links } from "@shortflare/links";

import type { Capability } from "./access-control";
import type { ManagementBindings } from "./environment";
import type { Identity, User } from "./modules/identity";
import type { RequestAuthentication } from "./transport/request-authentication";

export type ManagementDependencies = Readonly<{
  createAnalytics(bindings: ManagementBindings): Analytics;
  createIdentity(bindings: ManagementBindings): Identity;
  createLinks(bindings: ManagementBindings): Links;
  createRequestAuthentication(bindings: ManagementBindings): RequestAuthentication;
  hasCapability(user: User, capability: Capability): boolean;
}>;
