import type { Links } from "@shortflare/links";

import type { Capability } from "./access-control";
import type { ManagementBindings } from "./environment";
import type { Identity, User } from "./identity";
import type { RequestAuthentication } from "./transport/request-authentication";

export type ManagementDependencies = Readonly<{
  createIdentity(bindings: ManagementBindings): Identity;
  createLinks(bindings: ManagementBindings): Links;
  createRequestAuthentication(bindings: ManagementBindings): RequestAuthentication;
  hasCapability(user: User, capability: Capability): boolean;
}>;
