import { describe } from "vitest";

import { registerDestinationVersionContract } from "./contract-destination-versions";
import { registerLinkLifecycleContract } from "./contract-lifecycle";
import { registerLinkManagementContract } from "./contract-management";
import { registerLinkPaginationContract } from "./contract-pagination";
import type { LinksContractFactory } from "./contract-support";

export function linksContract(createTestLinks: LinksContractFactory) {
  const actor = { id: "user-1" };

  describe("Links contract", () => {
    registerLinkLifecycleContract(createTestLinks, actor);
    registerLinkManagementContract(createTestLinks, actor);
    registerDestinationVersionContract(createTestLinks, actor);
    registerLinkPaginationContract(createTestLinks, actor);
  });
}
