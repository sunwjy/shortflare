import { expect, it } from "vitest";

import type { ContractActor, LinksContractFactory } from "./contract-support";

export function registerLinkLifecycleContract(
  createTestLinks: LinksContractFactory,
  actor: ContractActor,
) {
  it("creates an Active Link and resolves it with stored query values winning collisions", async () => {
    const links = createTestLinks();

    const created = await links.execute(
      {
        kind: "create",
        alias: "Docs",
        destination: "https://example.com/guide?tag=stored&tag=second",
        title: "Documentation",
      },
      actor,
    );

    expect(created).toMatchObject({
      ok: true,
      kind: "link",
      changed: true,
      link: {
        alias: "Docs",
        state: "active",
        title: "Documentation",
      },
    });
    await expect(links.resolve("Docs", "tag=incoming&source=shortflare")).resolves.toEqual({
      kind: "redirect",
      destination: "https://example.com/guide?tag=stored&tag=second&source=shortflare",
      destinationVersionId: "id-2",
      linkId: "id-1",
    });
  });

  it("rejects a custom Alias instead of trimming or changing its case", async () => {
    const links = createTestLinks();

    await expect(
      links.execute(
        {
          kind: "create",
          alias: " Docs ",
          destination: "https://example.com",
          title: "Documentation",
        },
        actor,
      ),
    ).resolves.toEqual({
      ok: false,
      kind: "invalid-alias",
      alias: " Docs ",
    });
    await expect(links.resolve("Docs")).resolves.toEqual({
      kind: "not-found",
    });
  });

  it("normalizes a one-line title and rejects control characters", async () => {
    const links = createTestLinks();

    const created = await links.execute(
      {
        kind: "create",
        alias: "Docs",
        destination: "https://example.com",
        title: "  Documentation  ",
      },
      actor,
    );
    expect(created).toMatchObject({
      ok: true,
      link: { title: "Documentation" },
    });

    await expect(
      links.execute(
        {
          kind: "create",
          alias: "Other",
          destination: "https://example.com",
          title: "Line one\nLine two",
        },
        actor,
      ),
    ).resolves.toEqual({
      ok: false,
      kind: "invalid-title",
    });
    await expect(
      links.execute(
        {
          kind: "create",
          alias: "Separator",
          destination: "https://example.com",
          title: "Line one\u2028Line two",
        },
        actor,
      ),
    ).resolves.toEqual({
      ok: false,
      kind: "invalid-title",
    });
  });

  it.each([
    ["not-a-url", "malformed"],
    ["ftp://example.com/file", "unsupported-protocol"],
    ["https://user:secret@example.com", "credentials"],
    ["http://GO.EXAMPLE.COM.:8080/loop", "redirect-loop"],
    [`https://example.com/${"x".repeat(8_193)}`, "too-long"],
  ] as const)("rejects unsafe Destination case %#", async (destination, reason) => {
    const links = createTestLinks();

    await expect(
      links.execute(
        {
          kind: "create",
          alias: "Docs",
          destination,
          title: "Documentation",
        },
        actor,
      ),
    ).resolves.toEqual({
      ok: false,
      kind: "invalid-destination",
      reason,
    });
  });

  it("edits title and Destination atomically and increments the Link revision", async () => {
    const links = createTestLinks();
    const created = await links.execute(
      {
        kind: "create",
        alias: "Docs",
        destination: "HTTPS://EXAMPLE.COM:443",
        title: "Documentation",
      },
      actor,
    );
    if (!created.ok || created.kind !== "link") {
      throw new Error("expected Link creation to succeed");
    }
    expect(created.link.revision).toBe(0);

    const unchanged = await links.execute(
      {
        kind: "edit",
        linkId: created.link.id,
        expectedRevision: 0,
        title: "Documentation",
        destination: "https://example.com/",
      },
      actor,
    );
    expect(unchanged).toMatchObject({
      ok: true,
      kind: "link",
      changed: false,
      link: {
        revision: 0,
        destinationVersions: [{ destination: "https://example.com/", versionNumber: 1 }],
      },
    });

    const changed = await links.execute(
      {
        kind: "edit",
        linkId: created.link.id,
        expectedRevision: 0,
        title: "Updated documentation",
        destination: "https://example.com/v2",
      },
      actor,
    );
    expect(changed).toMatchObject({
      ok: true,
      kind: "link",
      changed: true,
      link: {
        revision: 1,
        title: "Updated documentation",
        state: "active",
        destinationVersions: [{ destination: "https://example.com/v2", versionNumber: 2 }],
      },
    });
  });

  it("enforces the Active, Disabled, and Archived lifecycle", async () => {
    const links = createTestLinks();
    const created = await links.execute(
      {
        kind: "create",
        alias: "Docs",
        destination: "https://example.com",
        title: "Documentation",
      },
      actor,
    );
    if (!created.ok || created.kind !== "link") {
      throw new Error("expected Link creation to succeed");
    }
    const linkId = created.link.id;

    const disabled = await links.execute({ kind: "disable", linkId, expectedRevision: 0 }, actor);
    expect(disabled).toMatchObject({
      ok: true,
      changed: true,
      link: { state: "disabled", revision: 1 },
    });
    await expect(links.resolve("Docs")).resolves.toEqual({
      kind: "not-found",
    });
    await expect(
      links.execute({ kind: "disable", linkId, expectedRevision: 0 }, actor),
    ).resolves.toEqual({
      ok: false,
      kind: "link-conflict",
      currentRevision: 1,
    });
    await expect(
      links.execute({ kind: "disable", linkId, expectedRevision: 1 }, actor),
    ).resolves.toMatchObject({
      ok: true,
      changed: false,
    });

    await expect(
      links.execute({ kind: "activate", linkId, expectedRevision: 1 }, actor),
    ).resolves.toMatchObject({
      ok: true,
      changed: true,
      link: { state: "active", revision: 2 },
    });
    await expect(
      links.execute({ kind: "archive", linkId, expectedRevision: 2 }, actor),
    ).resolves.toMatchObject({
      ok: true,
      changed: true,
      link: { state: "archived", revision: 3 },
    });
    await expect(links.resolve("Docs")).resolves.toEqual({ kind: "gone" });
    await expect(
      links.execute(
        {
          kind: "edit",
          linkId,
          expectedRevision: 3,
          destination: "https://example.com/new",
        },
        actor,
      ),
    ).resolves.toEqual({
      ok: false,
      kind: "invalid-state",
      command: "edit",
      state: "archived",
    });

    await expect(
      links.execute({ kind: "restore", linkId, expectedRevision: 3 }, actor),
    ).resolves.toMatchObject({
      ok: true,
      changed: true,
      link: { state: "disabled", revision: 4 },
    });
  });

  it("reserves an Alias after permanent deletion until it is explicitly released", async () => {
    const links = createTestLinks();
    const created = await links.execute(
      {
        kind: "create",
        alias: "Docs",
        destination: "https://example.com",
        title: "Documentation",
      },
      actor,
    );
    if (!created.ok || created.kind !== "link") {
      throw new Error("expected Link creation to succeed");
    }
    const linkId = created.link.id;

    await expect(
      links.execute(
        {
          kind: "permanently-delete",
          linkId,
          expectedRevision: 0,
          confirmationAlias: "Docs",
        },
        actor,
      ),
    ).resolves.toEqual({
      ok: false,
      kind: "invalid-state",
      command: "permanently-delete",
      state: "active",
    });
    await links.execute({ kind: "archive", linkId, expectedRevision: 0 }, actor);
    await expect(
      links.execute(
        {
          kind: "permanently-delete",
          linkId,
          expectedRevision: 1,
          confirmationAlias: "docs",
        },
        actor,
      ),
    ).resolves.toEqual({
      ok: false,
      kind: "confirmation-mismatch",
    });
    await expect(
      links.execute(
        {
          kind: "permanently-delete",
          linkId,
          expectedRevision: 1,
          confirmationAlias: "Docs",
        },
        actor,
      ),
    ).resolves.toEqual({
      ok: true,
      kind: "deleted",
      reservedAlias: {
        alias: "Docs",
        deletedLinkId: linkId,
        reservedAt: new Date("2026-07-23T00:00:00.000Z"),
      },
    });
    await expect(
      links.query({ kind: "reserved-aliases", search: "docs" }, actor),
    ).resolves.toMatchObject({
      ok: true,
      kind: "reserved-alias-page",
      page: {
        items: [{ alias: "Docs", deletedLinkId: linkId }],
        nextCursor: null,
      },
    });
    await expect(links.resolve("Docs")).resolves.toEqual({ kind: "gone" });

    await expect(
      links.execute(
        {
          kind: "create",
          alias: "Docs",
          destination: "https://example.com/new",
          title: "New documentation",
        },
        actor,
      ),
    ).resolves.toEqual({
      ok: false,
      kind: "alias-reserved",
      alias: "Docs",
    });

    await expect(
      links.execute({ kind: "release-alias", alias: "Docs", confirmationAlias: "docs" }, actor),
    ).resolves.toEqual({ ok: false, kind: "confirmation-mismatch" });
    await expect(
      links.execute({ kind: "release-alias", alias: "Docs", confirmationAlias: "Docs" }, actor),
    ).resolves.toEqual({
      ok: true,
      kind: "released",
      alias: "Docs",
    });
    await expect(links.resolve("Docs")).resolves.toEqual({
      kind: "not-found",
    });
  });
}
