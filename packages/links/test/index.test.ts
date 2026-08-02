import { createInMemoryLinksPersistence } from "../src/in-memory-persistence";
import { createLinks } from "../src/index";
import { linksContract } from "./contract";

linksContract((overrides = {}) => {
  let id = 0;

  return createLinks({
    persistence: createInMemoryLinksPersistence(),
    redirectDomain: "go.example.com",
    generateId: () => `id-${++id}`,
    generateAlias: overrides.generateAlias ?? (() => "Random"),
    now: overrides.now ?? (() => new Date("2026-07-23T00:00:00.000Z")),
  });
});
