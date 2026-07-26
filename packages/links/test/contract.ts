import { describe, expect, it } from "vitest";

import type { CreateLinksOptions, Links } from "../src/index";

type LinksContractFactory = (overrides?: Pick<CreateLinksOptions, "generateAlias">) => Links;

export function linksContract(createTestLinks: LinksContractFactory) {
  const actor = { id: "user-1" };

  describe("Links contract", () => {
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

    it("appends a Destination Version only when the normalized Destination changes", async () => {
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

      const unchanged = await links.execute(
        {
          kind: "update-destination",
          linkId: created.link.id,
          destination: "https://example.com/",
        },
        actor,
      );
      expect(unchanged).toMatchObject({
        ok: true,
        kind: "link",
        changed: false,
        link: { destinationVersions: [{ destination: "https://example.com/" }] },
      });

      const changed = await links.execute(
        {
          kind: "update-destination",
          linkId: created.link.id,
          destination: "https://example.com/v2",
        },
        actor,
      );
      expect(changed).toMatchObject({
        ok: true,
        kind: "link",
        changed: true,
        link: {
          state: "active",
          destinationVersions: [
            { destination: "https://example.com/" },
            { destination: "https://example.com/v2" },
          ],
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

      const disabled = await links.execute({ kind: "disable", linkId }, actor);
      expect(disabled).toMatchObject({
        ok: true,
        changed: true,
        link: { state: "disabled" },
      });
      await expect(links.resolve("Docs")).resolves.toEqual({
        kind: "not-found",
      });
      await expect(links.execute({ kind: "disable", linkId }, actor)).resolves.toMatchObject({
        ok: true,
        changed: false,
      });

      await expect(links.execute({ kind: "activate", linkId }, actor)).resolves.toMatchObject({
        ok: true,
        changed: true,
        link: { state: "active" },
      });
      await expect(links.execute({ kind: "archive", linkId }, actor)).resolves.toMatchObject({
        ok: true,
        changed: true,
        link: { state: "archived" },
      });
      await expect(links.resolve("Docs")).resolves.toEqual({ kind: "gone" });
      await expect(
        links.execute(
          {
            kind: "update-destination",
            linkId,
            destination: "https://example.com/new",
          },
          actor,
        ),
      ).resolves.toEqual({
        ok: false,
        kind: "invalid-state",
        command: "update-destination",
        state: "archived",
      });

      await expect(links.execute({ kind: "restore", linkId }, actor)).resolves.toMatchObject({
        ok: true,
        changed: true,
        link: { state: "disabled" },
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

      await expect(links.execute({ kind: "permanently-delete", linkId }, actor)).resolves.toEqual({
        ok: false,
        kind: "invalid-state",
        command: "permanently-delete",
        state: "active",
      });
      await links.execute({ kind: "archive", linkId }, actor);
      await expect(links.execute({ kind: "permanently-delete", linkId }, actor)).resolves.toEqual({
        ok: true,
        kind: "deleted",
        alias: "Docs",
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

      await expect(links.execute({ kind: "release-alias", alias: "Docs" }, actor)).resolves.toEqual(
        {
          ok: true,
          kind: "released",
          alias: "Docs",
        },
      );
      await expect(links.resolve("Docs")).resolves.toEqual({
        kind: "not-found",
      });
    });

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
      await links.execute({ kind: "disable", linkId: disabled.link.id }, actor);
      await links.execute({ kind: "archive", linkId: archived.link.id }, actor);

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

    it("updates a Link title unless the Link is Archived", async () => {
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
        links.execute({ kind: "update-title", linkId, title: " New title " }, actor),
      ).resolves.toMatchObject({
        ok: true,
        changed: true,
        link: { title: "New title" },
      });
      await expect(
        links.execute({ kind: "update-title", linkId, title: "New title" }, actor),
      ).resolves.toMatchObject({ ok: true, changed: false });

      await links.execute({ kind: "archive", linkId }, actor);
      await expect(
        links.execute({ kind: "update-title", linkId, title: "No" }, actor),
      ).resolves.toEqual({
        ok: false,
        kind: "invalid-state",
        command: "update-title",
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

    it("preserves every Destination Version across concurrent last-write-wins updates", async () => {
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

      await Promise.all([
        links.execute(
          {
            kind: "update-destination",
            linkId: created.link.id,
            destination: "https://example.com/v2",
          },
          actor,
        ),
        links.execute(
          {
            kind: "update-destination",
            linkId: created.link.id,
            destination: "https://example.com/v3",
          },
          actor,
        ),
      ]);

      await expect(
        links.query({ kind: "detail", linkId: created.link.id }, actor),
      ).resolves.toMatchObject({
        ok: true,
        kind: "detail",
        link: {
          destinationVersions: [
            { destination: "https://example.com/v1" },
            { destination: "https://example.com/v2" },
            { destination: "https://example.com/v3" },
          ],
        },
      });
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

    it("continues keyset pagination after the cursor Link is deleted", async () => {
      const links = createTestLinks();
      const createdLinks = [];
      for (const alias of ["First", "Second", "Third"]) {
        // These writes are intentionally sequential so their generated IDs
        // define the expected tie-break order for the fixed test timestamp.
        // oxlint-disable-next-line no-await-in-loop
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
        createdLinks.push(created.link);
      }

      const firstPage = await links.query({ kind: "list", limit: 2 }, actor);
      if (!firstPage.ok || firstPage.kind !== "page" || firstPage.page.nextCursor === null) {
        throw new Error("expected a paginated Link page");
      }
      expect(firstPage.page.items.map((link) => link.alias)).toEqual(["First", "Second"]);

      const cursorLink = createdLinks[1];
      if (cursorLink === undefined) throw new Error("expected cursor Link");
      await links.execute({ kind: "archive", linkId: cursorLink.id }, actor);
      await links.execute({ kind: "permanently-delete", linkId: cursorLink.id }, actor);

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
  });
}
