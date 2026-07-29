import { describe, expect, it } from "vitest";

import { buildSequentialFixtures } from "../../../test/support/sequential-fixtures";
import type { CreateLinksOptions } from "../src/persistence";
import type { Links } from "../src/index";

type LinksContractFactory = (
  overrides?: Pick<CreateLinksOptions, "generateAlias" | "now">,
) => Links;

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
      await links.execute(
        { kind: "disable", linkId: disabled.link.id, expectedRevision: 0 },
        actor,
      );
      await links.execute(
        { kind: "archive", linkId: archived.link.id, expectedRevision: 0 },
        actor,
      );

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
      if (
        !first.ok ||
        first.kind !== "destination-version-page" ||
        first.page.nextCursor === null
      ) {
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
      if (
        !first.ok ||
        first.kind !== "destination-version-page" ||
        first.page.nextCursor === null
      ) {
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
        await links.execute(
          { kind: "archive", linkId: created.link.id, expectedRevision: 0 },
          actor,
        );
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
  });
}
