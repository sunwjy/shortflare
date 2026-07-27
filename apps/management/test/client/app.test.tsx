import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/client/app";

const viewerSession = {
  ok: true,
  csrfToken: "csrf-viewer",
  user: {
    id: "user-viewer",
    email: "viewer@example.com",
    role: "viewer",
    state: "active",
  },
};

const memberSession = {
  ok: true,
  csrfToken: "csrf-member",
  user: {
    id: "user-member",
    email: "member@example.com",
    role: "member",
    state: "active",
  },
};

const administratorSession = {
  ok: true,
  csrfToken: "csrf-admin",
  user: {
    id: "user-admin",
    email: "admin@example.com",
    role: "administrator",
    state: "active",
  },
};

const documentationLink = {
  id: "link-docs",
  alias: "Docs",
  shortUrl: "https://short.test/Docs",
  title: "Documentation",
  state: "active",
  revision: 3,
  destination: {
    id: "destination-docs",
    versionNumber: 2,
    url: "https://example.com/documentation",
    createdAt: "2026-07-26T04:00:00.000Z",
  },
  createdAt: "2026-07-20T02:00:00.000Z",
  updatedAt: "2026-07-26T04:00:00.000Z",
};

function notFound() {
  return Response.json({ ok: false, kind: "not-found", details: {} }, { status: 404 });
}

afterEach(() => {
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

describe("Management App", () => {
  it("shows a URL-filtered Link collection without mutation controls to a Viewer", async () => {
    history.replaceState(null, "", "/links?search=docs&state=active");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), location.origin);
        if (url.pathname === "/api/internal/auth/session") {
          return Response.json(viewerSession);
        }
        if (url.pathname === "/api/internal/links") {
          expect(url.searchParams.get("search")).toBe("docs");
          expect(url.searchParams.getAll("state")).toEqual(["active"]);
          return Response.json({
            ok: true,
            items: [documentationLink],
            nextCursor: null,
          });
        }
        return notFound();
      }),
    );

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Links" })).toBeInTheDocument();
    expect(await screen.findByText("Documentation")).toBeInTheDocument();
    expect(screen.getByText("https://short.test/Docs")).toBeInTheDocument();
    const row = screen.getByText("Documentation").closest("article");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("Active")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create Link" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
  });

  it("lets a Member search and filter the Link collection, then copy a short URL", async () => {
    history.replaceState(null, "", "/links");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), location.origin);
        if (url.pathname === "/api/internal/auth/session") {
          return Response.json(memberSession);
        }
        if (url.pathname === "/api/internal/links") {
          const filtered =
            url.searchParams.get("search") === "launch" &&
            url.searchParams.getAll("state").includes("archived");
          return Response.json({
            ok: true,
            items: filtered
              ? [
                  {
                    ...documentationLink,
                    id: "link-launch",
                    alias: "Launch",
                    shortUrl: "https://short.test/Launch",
                    title: "Launch plan",
                    state: "archived",
                  },
                ]
              : [documentationLink],
            nextCursor: null,
          });
        }
        return notFound();
      }),
    );
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");

    render(<App />);
    expect(await screen.findByText("Documentation")).toBeInTheDocument();

    await user.type(screen.getByRole("searchbox", { name: "Search Links" }), "launch");
    await user.click(screen.getByRole("button", { name: "Archived" }));
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("Launch plan")).toBeInTheDocument();
    await waitFor(() => {
      expect(location.search).toContain("search=launch");
    });
    await user.click(screen.getByRole("button", { name: "Copy short URL for Launch plan" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("https://short.test/Launch");
    });
    expect(screen.getByRole("button", { name: "Copied short URL for Launch plan" })).toBeVisible();
  });

  it("lets a Member create a Link and opens its URL-addressable detail", async () => {
    history.replaceState(null, "", "/links/new");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), location.origin);
        if (url.pathname === "/api/internal/auth/session") {
          return Response.json(memberSession);
        }
        if (url.pathname === "/api/internal/links" && (init?.method ?? "GET") === "GET") {
          return Response.json({ ok: true, items: [], nextCursor: null });
        }
        if (url.pathname === "/api/internal/links" && init?.method === "POST") {
          expect(init.headers).toMatchObject({ "x-csrf-token": "csrf-member" });
          expect(JSON.parse(String(init.body))).toEqual({
            alias: "Docs",
            destination: "https://example.com/documentation",
            title: "Documentation",
          });
          return Response.json({ ok: true, link: documentationLink }, { status: 201 });
        }
        if (url.pathname === "/api/internal/links/link-docs") {
          return Response.json({ ok: true, link: documentationLink });
        }
        if (url.pathname.endsWith("/destination-versions")) {
          return Response.json({
            ok: true,
            items: [],
            nextCursor: null,
            currentVersionNumber: 2,
          });
        }
        return notFound();
      }),
    );
    const user = userEvent.setup();

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Create Link" })).toBeInTheDocument();
    await user.type(
      screen.getByRole("textbox", { name: "Destination" }),
      "https://example.com/documentation",
    );
    await user.click(screen.getByRole("checkbox", { name: "Use a custom Alias" }));
    await user.type(screen.getByRole("textbox", { name: "Alias" }), "Docs");
    await user.type(screen.getByRole("textbox", { name: "Title" }), "Documentation");
    const creationPanel = screen.getByRole("complementary", { name: "Create Link panel" });
    await user.click(within(creationPanel).getByRole("button", { name: "Create Link" }));

    expect(await screen.findByRole("heading", { name: "Documentation" })).toBeInTheDocument();
    expect(location.pathname).toBe("/links/link-docs");
    expect(screen.getByText("https://short.test/Docs")).toBeVisible();
  });

  it("preserves a Member's edit and shows the current Link after a revision conflict", async () => {
    history.replaceState(null, "", "/links/link-docs");
    const currentLink = {
      ...documentationLink,
      title: "Updated by teammate",
      revision: 4,
      destination: {
        ...documentationLink.destination,
        id: "destination-current",
        versionNumber: 3,
        url: "https://example.com/current",
      },
    };
    let detailReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), location.origin);
        if (url.pathname === "/api/internal/auth/session") {
          return Response.json(memberSession);
        }
        if (url.pathname === "/api/internal/links" && (init?.method ?? "GET") === "GET") {
          return Response.json({ ok: true, items: [documentationLink], nextCursor: null });
        }
        if (url.pathname === "/api/internal/links/link-docs" && init?.method === "PATCH") {
          expect(JSON.parse(String(init.body))).toEqual({
            expectedRevision: 3,
            title: "My documentation",
            destination: "https://example.com/mine",
          });
          return Response.json(
            { ok: false, kind: "link-conflict", details: { currentRevision: 4 } },
            { status: 409 },
          );
        }
        if (url.pathname === "/api/internal/links/link-docs") {
          detailReads += 1;
          return Response.json({
            ok: true,
            link: detailReads === 1 ? documentationLink : currentLink,
          });
        }
        if (url.pathname.endsWith("/destination-versions")) {
          return Response.json({
            ok: true,
            items: [],
            nextCursor: null,
            currentVersionNumber: 2,
          });
        }
        return notFound();
      }),
    );
    const user = userEvent.setup();

    render(<App />);
    expect(await screen.findByRole("heading", { name: "Documentation" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit Link" }));
    const title = screen.getByRole("textbox", { name: "Title" });
    const destination = screen.getByRole("textbox", { name: "Destination" });
    await user.clear(title);
    await user.type(title, "My documentation");
    await user.clear(destination);
    await user.type(destination, "https://example.com/mine");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(
      await screen.findByRole("heading", { name: "Link changed elsewhere" }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("My documentation")).toBeVisible();
    expect(within(screen.getByRole("alert")).getByText("Updated by teammate")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Discard mine" }));
    expect(await screen.findByRole("heading", { name: "Updated by teammate" })).toBeInTheDocument();
    expect(screen.queryByDisplayValue("My documentation")).not.toBeInTheDocument();
  });

  it("lets a Member disable an Active Link from its detail", async () => {
    history.replaceState(null, "", "/links/link-docs");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), location.origin);
        if (url.pathname === "/api/internal/auth/session") return Response.json(memberSession);
        if (url.pathname === "/api/internal/links") {
          return Response.json({ ok: true, items: [documentationLink], nextCursor: null });
        }
        if (url.pathname.endsWith("/destination-versions")) {
          return Response.json({
            ok: true,
            items: [],
            nextCursor: null,
            currentVersionNumber: 2,
          });
        }
        if (url.pathname === "/api/internal/links/link-docs/disable") {
          expect(init?.method).toBe("POST");
          expect(JSON.parse(String(init?.body))).toEqual({ expectedRevision: 3 });
          return Response.json({
            ok: true,
            changed: true,
            link: { ...documentationLink, state: "disabled", revision: 4 },
          });
        }
        if (url.pathname === "/api/internal/links/link-docs") {
          return Response.json({ ok: true, link: documentationLink });
        }
        return notFound();
      }),
    );
    const user = userEvent.setup();

    render(<App />);
    expect(await screen.findByRole("heading", { name: "Documentation" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Disable Link" }));

    expect(await screen.findByText("Link disabled.")).toBeVisible();
    expect(
      within(screen.getByRole("complementary", { name: "Link detail" })).getByText("Disabled"),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Activate Link" })).toBeVisible();
  });

  it("keeps an Administrator's destructive confirmation through reauthentication", async () => {
    history.replaceState(null, "", "/links/link-docs");
    const archivedLink = { ...documentationLink, state: "archived", revision: 5 };
    let deletionAttempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), location.origin);
        if (url.pathname === "/api/internal/auth/session")
          return Response.json(administratorSession);
        if (url.pathname === "/api/internal/links") {
          return Response.json({ ok: true, items: [archivedLink], nextCursor: null });
        }
        if (url.pathname === "/api/internal/links/link-docs") {
          return Response.json({ ok: true, link: archivedLink });
        }
        if (url.pathname.endsWith("/destination-versions")) {
          return Response.json({
            ok: true,
            items: [],
            nextCursor: null,
            currentVersionNumber: 2,
          });
        }
        if (url.pathname.endsWith("/permanently-delete")) {
          deletionAttempts += 1;
          expect(JSON.parse(String(init?.body))).toEqual({
            expectedRevision: 5,
            confirmationAlias: "Docs",
          });
          if (deletionAttempts === 1) {
            return Response.json(
              { ok: false, kind: "reauthentication-required", details: {} },
              { status: 403 },
            );
          }
          expect(init?.headers).toMatchObject({ "x-csrf-token": "csrf-refreshed" });
          return Response.json({
            ok: true,
            reservedAlias: {
              alias: "Docs",
              shortUrl: "https://short.test/Docs",
              deletedLinkId: "link-docs",
              reservedAt: "2026-07-27T00:00:00.000Z",
            },
          });
        }
        if (url.pathname === "/api/internal/auth/reauthenticate") {
          return Response.json({ ...administratorSession, csrfToken: "csrf-refreshed" });
        }
        return notFound();
      }),
    );
    const user = userEvent.setup();

    render(<App />);
    expect(await screen.findByRole("heading", { name: "Documentation" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Permanently delete" }));
    await user.type(screen.getByRole("textbox", { name: /Type Docs/ }), "Docs");
    await user.click(screen.getByRole("button", { name: "Permanently delete" }));

    await user.type(screen.getByLabelText("Current password"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "Verify password" }));
    expect(await screen.findByText(/Submit the action again/)).toBeVisible();
    expect(deletionAttempts).toBe(1);

    await user.click(screen.getByRole("button", { name: "Permanently delete" }));
    await waitFor(() => expect(deletionAttempts).toBe(2));
    expect(location.pathname).toBe("/links");
  });

  it("keeps personal Security and theme preferences available to a Member", async () => {
    history.replaceState(null, "", "/security");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), location.origin);
        if (url.pathname === "/api/internal/auth/session") return Response.json(memberSession);
        return notFound();
      }),
    );
    const user = userEvent.setup();

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Security" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Security" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: "Users" })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Theme"), "dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(localStorage.getItem("shortflare-theme")).toBe("dark");
  });

  it("shows User administration only to an Administrator", async () => {
    history.replaceState(null, "", "/users");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), location.origin);
        if (url.pathname === "/api/internal/auth/session")
          return Response.json(administratorSession);
        if (url.pathname === "/api/internal/users") {
          return Response.json({ ok: true, users: [administratorSession.user] });
        }
        return notFound();
      }),
    );

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Users" })).toBeVisible();
    expect(screen.getByText("admin@example.com")).toBeVisible();
    expect(screen.getByRole("button", { name: "Invite User" })).toBeVisible();
  });
});
