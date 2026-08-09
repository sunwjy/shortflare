import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/client/app";

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

afterEach(() => {
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

describe("Audit Event browsing", () => {
  it("filters and pages retained events without hiding deleted identifiers", async () => {
    history.replaceState(null, "", "/audit");
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), location.origin);
        if (url.pathname === "/api/internal/auth/session") {
          return Response.json(administratorSession);
        }
        if (url.pathname === "/api/internal/audit-events") {
          requests.push(url);
          if (url.searchParams.get("cursor") === "next-page") {
            return Response.json({
              ok: true,
              items: [
                {
                  id: "audit-old",
                  occurredAt: "2026-08-08T03:00:00.000Z",
                  actor: { id: "system", display: "Shortflare system" },
                  action: "create",
                  subject: { id: "deleted-link", kind: "link", display: null },
                  metadata: { alias: "Gone" },
                },
              ],
              nextCursor: null,
            });
          }
          return Response.json({
            ok: true,
            items: [
              {
                id: "audit-new",
                occurredAt: "2026-08-09T03:00:00.000Z",
                actor: { id: "user-admin", display: "admin@example.com" },
                action: "role-change",
                subject: { id: "user-member", kind: "user", display: "member@example.com" },
                metadata: { fromRole: "viewer", toRole: "member" },
              },
            ],
            nextCursor: "next-page",
          });
        }
        return Response.json({ ok: false, kind: "not-found", details: {} }, { status: 404 });
      }),
    );
    const user = userEvent.setup();

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Audit Events" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Audit" })).toBeVisible();
    expect(await screen.findByText("Role Changed")).toBeVisible();
    expect(screen.getByText("member@example.com")).toBeVisible();

    await user.selectOptions(screen.getByLabelText("Action"), "create");
    await user.type(screen.getByLabelText("Actor ID"), "system");
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    await waitFor(() => {
      const latest = requests.at(-1);
      expect(latest?.searchParams.getAll("action")).toEqual(["create"]);
      expect(latest?.searchParams.get("actorId")).toBe("system");
    });

    await user.click(screen.getByRole("button", { name: "Next page" }));
    const collection = await screen.findByRole("table", { name: "Audit Event collection" });
    expect(within(collection).getByText("deleted-link")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Next page" })).not.toBeInTheDocument();
  });
});
