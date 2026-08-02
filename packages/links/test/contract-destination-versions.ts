import { expect, it } from "vitest";

import { buildSequentialFixtures } from "../../../test/support/sequential-fixtures";
import type { ContractActor, LinksContractFactory } from "./contract-support";

export function registerDestinationVersionContract(
  createTestLinks: LinksContractFactory,
  actor: ContractActor,
) {
  it("pages Destination Version history newest first for an Archived Link", async () => {
    const links = createTestLinks();
    const created = await links.execute(
      {
        kind: "create",
        alias: "Docs",
        destination: "https://example.com/v1",
        title: "Documentation",
      },
      actor,
    );
    if (!created.ok || created.kind !== "link") {
      throw new Error("expected Link creation to succeed");
    }
    await links.execute(
      {
        kind: "edit",
        linkId: created.link.id,
        expectedRevision: 0,
        destination: "https://example.com/v2",
      },
      actor,
    );
    await links.execute(
      {
        kind: "edit",
        linkId: created.link.id,
        expectedRevision: 1,
        destination: "https://example.com/v3",
      },
      actor,
    );
    await links.execute({ kind: "archive", linkId: created.link.id, expectedRevision: 2 }, actor);

    const first = await links.query(
      { kind: "destination-versions", linkId: created.link.id, limit: 2 },
      actor,
    );
    expect(first).toMatchObject({
      ok: true,
      kind: "destination-version-page",
      page: {
        items: [
          { versionNumber: 3, destination: "https://example.com/v3" },
          { versionNumber: 2, destination: "https://example.com/v2" },
        ],
        nextCursor: expect.any(String),
      },
    });
    if (!first.ok || first.kind !== "destination-version-page" || first.page.nextCursor === null) {
      throw new Error("expected a Destination Version page");
    }

    await expect(
      links.query(
        {
          kind: "destination-versions",
          linkId: created.link.id,
          limit: 2,
          cursor: first.page.nextCursor,
        },
        actor,
      ),
    ).resolves.toMatchObject({
      ok: true,
      kind: "destination-version-page",
      page: {
        items: [{ versionNumber: 1, destination: "https://example.com/v1" }],
        nextCursor: null,
      },
    });
  });

  it("rejects a Destination Version cursor reused for another Link", async () => {
    const links = createTestLinks();
    const createdLinks = await buildSequentialFixtures(
      ["FirstHistory", "SecondHistory"],
      async (alias) => {
        const created = await links.execute(
          {
            kind: "create",
            alias,
            destination: `https://example.com/${alias.toLowerCase()}/v1`,
            title: alias,
          },
          actor,
        );
        if (!created.ok || created.kind !== "link") {
          throw new Error("expected Link creation to succeed");
        }
        await links.execute(
          {
            kind: "edit",
            linkId: created.link.id,
            expectedRevision: 0,
            destination: `https://example.com/${alias.toLowerCase()}/v2`,
          },
          actor,
        );
        return created.link;
      },
    );

    const first = await links.query(
      { kind: "destination-versions", linkId: createdLinks[0]!.id, limit: 1 },
      actor,
    );
    if (!first.ok || first.kind !== "destination-version-page" || first.page.nextCursor === null) {
      throw new Error("expected a paginated Destination Version page");
    }

    await expect(
      links.query(
        {
          kind: "destination-versions",
          linkId: createdLinks[1]!.id,
          limit: 1,
          cursor: first.page.nextCursor,
        },
        actor,
      ),
    ).resolves.toEqual({ ok: false, kind: "invalid-cursor" });
  });
}
