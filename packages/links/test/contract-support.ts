import type { Links } from "../src/index";
import type { CreateLinksOptions } from "../src/persistence";

export type LinksContractFactory = (
  overrides?: Pick<CreateLinksOptions, "generateAlias" | "now">,
) => Links;

export type ContractActor = Readonly<{ id: string }>;
