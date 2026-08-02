import { expect, it } from "vitest";

import { buildSequentialFixtures } from "../../../test/support/sequential-fixtures";
import type { ContractActor, LinksContractFactory } from "./contract-support";

export function registerLinkPaginationContract(
  createTestLinks: LinksContractFactory,
  actor: ContractActor,
) {
  it("pages Reserved Aliases and binds the cursor to the search", async () => {
    const links = createTestLinks();
    await buildSequentialFixtures(["alphaReserved", "BetaReserved"], async (alias) => {
      const created = await links.execute(
        {
          kind: "create",
          alias,
          destination: `https://example.com/${alias.toLowerCase()}`,
          title: alias,
        },
        actor,
      );
      if (!created.ok || created.kind !== "link") {
        throw new Error("expected Link creation to succeed");
      }
      await links.execute({ kind: "archive", linkId: created.link.id, expectedRevision: 0 }, actor);
      await links.execute(
        {
          kind: "permanently-delete",
          linkId: created.link.id,
          expectedRevision: 1,
          confirmationAlias: created.link.alias,
        },
        actor,
      );
      return created.link;
    });

    const first = await links.query(
      { kind: "reserved-aliases", search: "reserved", limit: 1 },
      actor,
    );
    expect(first).toMatchObject({
      ok: true,
      kind: "reserved-alias-page",
      page: {
        items: [{ alias: "BetaReserved" }],
        nextCursor: expect.any(String),
      },
    });
    if (!first.ok || first.kind !== "reserved-alias-page" || first.page.nextCursor === null) {
      throw new Error("expected a paginated Reserved Alias page");
    }

    await expect(
      links.query(
        {
          kind: "reserved-aliases",
          search: "reserved",
          limit: 1,
          cursor: first.page.nextCursor,
        },
        actor,
      ),
    ).resolves.toMatchObject({
      ok: true,
      kind: "reserved-alias-page",
      page: { items: [{ alias: "alphaReserved" }], nextCursor: null },
    });
    await expect(
      links.query(
        {
          kind: "reserved-aliases",
          search: "alpha",
          limit: 1,
          cursor: first.page.nextCursor,
        },
        actor,
      ),
    ).resolves.toEqual({ ok: false, kind: "invalid-cursor" });
  });

  it("uses Unicode case folding for management search", async () => {
    const links = createTestLinks();
    await links.execute(
      {
        kind: "create",
        alias: "Street",
        destination: "https://example.com",
        title: "Straße guide",
      },
      actor,
    );

    await expect(links.query({ kind: "list", search: "STRASSE" }, actor)).resolves.toMatchObject({
      ok: true,
      kind: "page",
      page: { items: [{ alias: "Street" }] },
    });
  });

  it("rejects malformed pagination cursors instead of restarting the list", async () => {
    const links = createTestLinks();

    await expect(
      links.query({ kind: "list", cursor: "not-a-versioned-cursor" }, actor),
    ).resolves.toEqual({
      ok: false,
      kind: "invalid-cursor",
    });
  });

  it("rejects cursor timestamps outside the JavaScript Date range", async () => {
    const links = createTestLinks();
    const linkCursor = btoa(
      JSON.stringify({
        v: 1,
        kind: "links",
        search: "",
        states: ["active", "disabled"],
        createdAt: Number.MAX_SAFE_INTEGER,
        id: "link-id",
      }),
    ).replace(/=+$/, "");
    const reservedAliasCursor = btoa(
      JSON.stringify({
        v: 1,
        kind: "reserved-aliases",
        search: "",
        reservedAt: Number.MAX_SAFE_INTEGER,
        alias: "Alias",
      }),
    ).replace(/=+$/, "");

    await expect(links.query({ kind: "list", cursor: linkCursor }, actor)).resolves.toEqual({
      ok: false,
      kind: "invalid-cursor",
    });
    await expect(
      links.query({ kind: "reserved-aliases", cursor: reservedAliasCursor }, actor),
    ).resolves.toEqual({
      ok: false,
      kind: "invalid-cursor",
    });
  });

  it("rejects a Link cursor reused with another search", async () => {
    const links = createTestLinks();
    await buildSequentialFixtures(["DocsOne", "DocsTwo"], (alias) =>
      links.execute(
        {
          kind: "create",
          alias,
          destination: `https://example.com/${alias.toLowerCase()}`,
          title: alias,
        },
        actor,
      ),
    );
    const first = await links.query({ kind: "list", search: "docs", limit: 1 }, actor);
    if (!first.ok || first.kind !== "page" || first.page.nextCursor === null) {
      throw new Error("expected a paginated Link page");
    }

    await expect(
      links.query(
        { kind: "list", search: "other", limit: 1, cursor: first.page.nextCursor },
        actor,
      ),
    ).resolves.toEqual({ ok: false, kind: "invalid-cursor" });
  });

  it("keeps Link pagination ordered by immutable creation time after an edit", async () => {
    let clock = new Date("2026-07-21T00:00:00.000Z");
    const links = createTestLinks({ now: () => clock });
    const created = await buildSequentialFixtures(
      ["First", "Second", "Third"],
      async (alias, index) => {
        clock = new Date(`2026-07-${21 + index}T00:00:00.000Z`);
        const result = await links.execute(
          {
            kind: "create",
            alias,
            destination: `https://example.com/${alias.toLowerCase()}`,
            title: alias,
          },
          actor,
        );
        if (!result.ok || result.kind !== "link") {
          throw new Error("expected Link creation to succeed");
        }
        return result.link;
      },
    );

    clock = new Date("2026-07-24T00:00:00.000Z");
    await links.execute(
      {
        kind: "edit",
        linkId: created[0]!.id,
        expectedRevision: 0,
        title: "Recently edited",
      },
      actor,
    );

    await expect(links.query({ kind: "list", limit: 2 }, actor)).resolves.toMatchObject({
      ok: true,
      kind: "page",
      page: {
        items: [{ alias: "Third" }, { alias: "Second" }],
        nextCursor: expect.any(String),
      },
    });
  });

  it("continues keyset pagination after the cursor Link is deleted", async () => {
    const links = createTestLinks();
    const createdLinks = await buildSequentialFixtures(
      ["First", "Second", "Third"],
      async (alias) => {
        const created = await links.execute(
          {
            kind: "create",
            alias,
            destination: `https://example.com/${alias.toLowerCase()}`,
            title: alias,
          },
          actor,
        );
        if (!created.ok || created.kind !== "link") {
          throw new Error("expected Link creation to succeed");
        }
        return created.link;
      },
    );

    const firstPage = await links.query({ kind: "list", limit: 2 }, actor);
    if (!firstPage.ok || firstPage.kind !== "page" || firstPage.page.nextCursor === null) {
      throw new Error("expected a paginated Link page");
    }
    expect(firstPage.page.items.map((link) => link.alias)).toEqual(["First", "Second"]);

    const cursorLink = createdLinks[1];
    if (cursorLink === undefined) throw new Error("expected cursor Link");
    await links.execute({ kind: "archive", linkId: cursorLink.id, expectedRevision: 0 }, actor);
    await links.execute(
      {
        kind: "permanently-delete",
        linkId: cursorLink.id,
        expectedRevision: 1,
        confirmationAlias: cursorLink.alias,
      },
      actor,
    );

    await expect(
      links.query({ kind: "list", limit: 2, cursor: firstPage.page.nextCursor }, actor),
    ).resolves.toMatchObject({
      ok: true,
      kind: "page",
      page: {
        items: [{ alias: "Third" }],
        nextCursor: null,
      },
    });
  });
}
