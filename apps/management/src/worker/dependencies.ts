import type { Links } from "@shortflare/links";

import type { ManagementBindings } from "./environment";
import type { Identity } from "./identity";

export type ManagementDependencies = Readonly<{
  createIdentity(bindings: ManagementBindings): Identity;
  createLinks(bindings: ManagementBindings): Links;
}>;
