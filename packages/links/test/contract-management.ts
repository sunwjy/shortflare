import { expect, it } from "vitest";

import type { ContractActor, LinksContractFactory } from "./contract-support";

export function registerLinkManagementContract(
  createTestLinks: LinksContractFactory,
  actor: ContractActor,
) {
  it("retries generated Aliases when a case-sensitive collision occurs", async () => {
    const generatedAliases = ["Taken1", "Fresh2"];
    const links = createTestLinks({
      generateAlias: () => generatedAliases.shift() ?? "Unused3",
    });
    await links.execute(
      {
        kind: "create",
        alias: "Taken1",
        destination: "https://example.com/one",
        title: "First",
      },
      actor,
    );

    const generated = await links.execute(
      {
        kind: "create",
        destination: "https://example.com/two",
        title: "Second",
      },
      actor,
    );

    expect(generated).toMatchObject({
      ok: true,
      kind: "link",
      link: { alias: "Fresh2" },
    });
    await expect(links.resolve("taken1")).resolves.toEqual({
      kind: "not-found",
    });
  });

  it("queries Links with case-insensitive search and hides Archived Links by default", async () => {
    const links = createTestLinks();
    const active = await links.execute(
      {
        kind: "create",
        alias: "DocsOne",
        destination: "https://example.com/one",
        title: "Product Guide",
      },
      actor,
    );
    const disabled = await links.execute(
      {
        kind: "create",
        alias: "Other",
        destination: "https://example.com/two",
        title: "DOCS reference",
      },
      actor,
    );
    const archived = await links.execute(
      {
        kind: "create",
        alias: "DocsOld",
        destination: "https://example.com/old",
        title: "Old guide",
      },
      actor,
    );
    if (
      !active.ok ||
      active.kind !== "link" ||
      !disabled.ok ||
      disabled.kind !== "link" ||
      !archived.ok ||
      archived.kind !== "link"
    ) {
      throw new Error("expected Link creation to succeed");
    }
    await links.execute({ kind: "disable", linkId: disabled.link.id, expectedRevision: 0 }, actor);
    await links.execute({ kind: "archive", linkId: archived.link.id, expectedRevision: 0 }, actor);

    const defaultPage = await links.query({ kind: "list", search: "docs" }, actor);
    expect(defaultPage).toMatchObject({
      ok: true,
      kind: "page",
      page: {
        items: [
          {
            id: active.link.id,
            state: "active",
            currentDestinationVersion: {
              destination: "https://example.com/one",
            },
          },
          {
            id: disabled.link.id,
            state: "disabled",
            currentDestinationVersion: {
              destination: "https://example.com/two",
            },
          },
        ],
      },
    });
    if (!defaultPage.ok || defaultPage.kind !== "page") {
      throw new Error("expected a Link page");
    }
    expect(defaultPage.page.items[0]).not.toHaveProperty("destinationVersions");

    await expect(
      links.query({ kind: "list", search: "docs", states: ["archived"] }, actor),
    ).resolves.toMatchObject({
      ok: true,
      kind: "page",
      page: { items: [{ id: archived.link.id, state: "archived" }] },
    });
    await expect(
      links.query({ kind: "detail", linkId: archived.link.id }, actor),
    ).resolves.toMatchObject({
      ok: true,
      kind: "detail",
      link: { id: archived.link.id, state: "archived" },
    });
  });

  it("queries Link summaries by ranked IDs without hiding Archived Links", async () => {
    const links = createTestLinks();
    const first = await links.execute(
      {
        kind: "create",
        alias: "First",
        destination: "https://example.com/first",
        title: "First Link",
      },
      actor,
    );
    const archived = await links.execute(
      {
        kind: "create",
        alias: "Archived",
        destination: "https://example.com/archived",
        title: "Archived Link",
      },
      actor,
    );
    if (!first.ok || first.kind !== "link" || !archived.ok || archived.kind !== "link") {
      throw new Error("expected Link creation to succeed");
    }
    await links.execute({ kind: "archive", linkId: archived.link.id, expectedRevision: 0 }, actor);

    await expect(
      links.query(
        { kind: "summaries", linkIds: [archived.link.id, "missing", first.link.id] },
        actor,
      ),
    ).resolves.toMatchObject({
      ok: true,
      kind: "summaries",
      items: [
        { id: archived.link.id, state: "archived" },
        { id: first.link.id, state: "active" },
      ],
    });
  });

  it("edits a Link title unless the Link is Archived", async () => {
    const links = createTestLinks();
    const created = await links.execute(
      {
        kind: "create",
        alias: "Docs",
        destination: "https://example.com",
        title: "Old title",
      },
      actor,
    );
    if (!created.ok || created.kind !== "link") {
      throw new Error("expected Link creation to succeed");
    }
    const linkId = created.link.id;

    await expect(
      links.execute({ kind: "edit", linkId, expectedRevision: 0, title: " New title " }, actor),
    ).resolves.toMatchObject({
      ok: true,
      changed: true,
      link: { title: "New title", revision: 1 },
    });
    await expect(
      links.execute({ kind: "edit", linkId, expectedRevision: 1, title: "New title" }, actor),
    ).resolves.toMatchObject({ ok: true, changed: false });

    await links.execute({ kind: "archive", linkId, expectedRevision: 1 }, actor);
    await expect(
      links.execute({ kind: "edit", linkId, expectedRevision: 2, title: "No" }, actor),
    ).resolves.toEqual({
      ok: false,
      kind: "invalid-state",
      command: "edit",
      state: "archived",
    });
  });

  it("preserves duplicate non-colliding incoming query values and the stored fragment", async () => {
    const links = createTestLinks();
    await links.execute(
      {
        kind: "create",
        alias: "Docs",
        destination: "https://example.com/path?stored=yes#section",
        title: "Documentation",
      },
      actor,
    );

    await expect(links.resolve("Docs", "source=one&source=two")).resolves.toMatchObject({
      kind: "redirect",
      destination: "https://example.com/path?stored=yes&source=one&source=two#section",
    });
  });

  it("rejects a concurrent edit after one command advances the revision", async () => {
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

    const results = await Promise.all([
      links.execute(
        {
          kind: "edit",
          linkId: created.link.id,
          expectedRevision: 0,
          destination: "https://example.com/v2",
        },
        actor,
      ),
      links.execute(
        {
          kind: "edit",
          linkId: created.link.id,
          expectedRevision: 0,
          destination: "https://example.com/v3",
        },
        actor,
      ),
    ]);

    expect(results).toEqual([
      expect.objectContaining({
        ok: true,
        changed: true,
        link: expect.objectContaining({ revision: 1 }),
      }),
      { ok: false, kind: "link-conflict", currentRevision: 1 },
    ]);
    await expect(
      links.query({ kind: "detail", linkId: created.link.id }, actor),
    ).resolves.toMatchObject({
      ok: true,
      kind: "detail",
      link: {
        revision: 1,
        destinationVersions: [{ destination: "https://example.com/v2", versionNumber: 2 }],
      },
    });
  });
}
