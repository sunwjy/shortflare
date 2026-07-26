import { env } from "cloudflare:workers";
import { beforeEach } from "vitest";

import { createLinks } from "@shortflare/links";
import { linksContract } from "../../links/test/contract";
import { createD1LinksPersistence } from "../src/index";
import { resetDatabase } from "./reset-database";

beforeEach(resetDatabase);

linksContract((overrides = {}) => {
  let id = 0;

  return createLinks({
    persistence: createD1LinksPersistence(env.DB),
    redirectDomain: "go.example.com",
    generateId: () => `id-${++id}`,
    generateAlias: overrides.generateAlias ?? (() => "Random"),
    now: () => new Date("2026-07-23T00:00:00.000Z"),
  });
});
