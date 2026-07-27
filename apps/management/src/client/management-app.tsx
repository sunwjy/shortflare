/* oxlint-disable react-perf/jsx-no-new-function-as-prop, react-perf/jsx-no-new-object-as-prop -- Route-level interaction handlers and search objects are intentionally colocated with their screens. */
import {
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Link,
  Outlet,
  redirect,
  RouterProvider,
} from "@tanstack/react-router";
import {
  Archive,
  CheckCircle2,
  Copy,
  Link2,
  PauseCircle,
  Search,
  Shield,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { ApiError, apiRequest } from "./api";
import { Button } from "./components/ui/button";
import { Dialog } from "./components/ui/dialog";
import type {
  DestinationVersionDto,
  LinkDto,
  LinkState,
  Page,
  ReservedAliasDto,
  Session,
} from "./types";

type ManagementRouterContext = Readonly<{
  session: Session;
  onSession: (session: Session | undefined) => void;
  queryClient: QueryClient;
  theme: Theme;
  setTheme: (theme: Theme) => void;
}>;

type Theme = "light" | "dark" | "system";
type LinkSearch = Readonly<{
  search?: string;
  state: readonly LinkState[];
}>;

const rootRoute = createRootRouteWithContext<ManagementRouterContext>()({
  component: AppShell,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/links", search: { state: [] } });
  },
});

const linksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "links",
  validateSearch: (raw): LinkSearch => ({
    ...(typeof raw.search === "string" && raw.search.trim() ? { search: raw.search.trim() } : {}),
    state: parseStates(raw.state),
  }),
  component: LinksPage,
});

const createLinkRoute = createRoute({
  getParentRoute: () => linksRoute,
  path: "new",
  component: CreateLinkPanel,
});

const linkDetailRoute = createRoute({
  getParentRoute: () => linksRoute,
  path: "$linkId",
  component: LinkDetailPanel,
});

const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "users",
  component: UsersPage,
});

const securityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "security",
  component: SecurityPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  linksRoute.addChildren([createLinkRoute, linkDetailRoute]),
  usersRoute,
  securityRoute,
]);

function createManagementRouter() {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
    context: undefined as never,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createManagementRouter>;
  }
}

export function ManagementApp({
  session,
  onSession,
}: Readonly<{
  session: Session;
  onSession: (session: Session | undefined) => void;
}>) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: 15_000 },
          mutations: { retry: false },
        },
      }),
  );
  const [router] = useState(createManagementRouter);
  const [theme, setTheme] = useState<Theme>(() => readTheme());

  useEffect(() => {
    window.localStorage.setItem("shortflare-theme", theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider
        router={router}
        context={{ session, onSession, queryClient, theme, setTheme }}
      />
    </QueryClientProvider>
  );
}

function AppShell() {
  const { session, theme, setTheme } = rootRoute.useRouteContext();
  return (
    <div className="app-shell">
      <aside className="navigation-rail">
        <a className="wordmark" href="/links" aria-label="Shortflare home">
          <span aria-hidden="true">S</span>
          <strong>Shortflare</strong>
        </a>
        <nav aria-label="Primary navigation">
          <Link to="/links" search={{ state: [] }} activeProps={{ "aria-current": "page" }}>
            <Link2 aria-hidden="true" size={20} strokeWidth={1.75} />
            Links
          </Link>
          {session.user.role === "administrator" && (
            <Link to="/users" activeProps={{ "aria-current": "page" }}>
              <Users aria-hidden="true" size={20} strokeWidth={1.75} />
              Users
            </Link>
          )}
        </nav>
        <div className="user-summary">
          <span>{session.user.email}</span>
          <small>{roleLabel(session.user.role)}</small>
          <Link to="/security" activeProps={{ "aria-current": "page" }}>
            <Shield aria-hidden="true" size={18} strokeWidth={1.75} />
            Security
          </Link>
          <label>
            Theme
            <select
              aria-label="Theme"
              value={theme}
              onChange={(event) => setTheme(event.target.value as Theme)}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>
      </aside>
      <main className="work-area">
        <Outlet />
      </main>
    </div>
  );
}

function UsersPage() {
  const { session } = rootRoute.useRouteContext();
  const queryClient = useQueryClient();
  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Session["user"]["role"]>("member");
  const [invitationLink, setInvitationLink] = useState("");
  const users = useQuery({
    queryKey: ["users"],
    queryFn: () =>
      apiRequest<{ ok: true; users: readonly Session["user"][] }>("/api/internal/users"),
    enabled: session.user.role === "administrator",
  });
  const invitation = useMutation({
    mutationFn: () =>
      apiRequest<{ ok: true; invitation: { token: string } }>("/api/internal/users/invitations", {
        method: "POST",
        csrfToken: session.csrfToken,
        body: { email, role },
      }),
    onSuccess: async ({ invitation: createdInvitation }) => {
      setInvitationLink(
        `${location.origin}/accept-invitation#token=${encodeURIComponent(createdInvitation.token)}`,
      );
      setInviting(false);
      setEmail("");
      await queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });

  if (session.user.role !== "administrator") {
    return (
      <section className="empty-state">
        <h1>Not available</h1>
        <p>User administration is restricted to Administrators.</p>
      </section>
    );
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Users</h1>
          <p>Invite people and manage access to this Instance.</p>
        </div>
        <Button onClick={() => setInviting(true)}>Invite User</Button>
      </header>
      {invitationLink && (
        <section className="notice one-time-link" aria-label="One-time Invitation link">
          <strong>Copy this one-time link now</strong>
          <code>{invitationLink}</code>
        </section>
      )}
      <section className="collection" aria-label="User collection">
        {users.isPending && <LinkRowsSkeleton />}
        {users.data?.users.map((user) => (
          <article className="user-row" key={user.id}>
            <div>
              <strong>{user.email}</strong>
              <span>{roleLabel(user.role)}</span>
            </div>
            <StatusChipForUser state={user.state} />
          </article>
        ))}
      </section>
      <Dialog
        open={inviting}
        onOpenChange={setInviting}
        title="Invite User"
        description="Create a one-time invitation for a new Shortflare User."
      >
        <form
          className="link-form"
          onSubmit={(event) => {
            event.preventDefault();
            invitation.mutate();
          }}
        >
          <div className="field">
            <label htmlFor="invite-email">Email</label>
            <input
              required
              id="invite-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="invite-role">Role</label>
            <select
              id="invite-role"
              value={role}
              onChange={(event) => setRole(event.target.value as Session["user"]["role"])}
            >
              <option value="member">Member</option>
              <option value="viewer">Viewer</option>
              <option value="administrator">Administrator</option>
            </select>
          </div>
          {invitation.isError && (
            <p className="field-error">The invitation could not be created.</p>
          )}
          <Button type="submit" disabled={invitation.isPending}>
            Create Invitation
          </Button>
        </form>
      </Dialog>
    </>
  );
}

function SecurityPage() {
  const { session, onSession } = rootRoute.useRouteContext();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [notice, setNotice] = useState("");

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setNotice("");
    try {
      await apiRequest("/api/internal/auth/password", {
        method: "POST",
        csrfToken: session.csrfToken,
        body: { currentPassword, password: newPassword },
      });
      onSession(undefined);
    } catch {
      setNotice("The password could not be changed.");
    }
  }

  async function logout() {
    await apiRequest("/api/internal/auth/logout", {
      method: "POST",
      csrfToken: session.csrfToken,
      body: {},
    }).catch(() => undefined);
    onSession(undefined);
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Security</h1>
          <p>Manage your password and active Session.</p>
        </div>
        <Button variant="secondary" onClick={() => void logout()}>
          Log out
        </Button>
      </header>
      <section className="settings-grid">
        <article className="card">
          <h2>Change password</h2>
          <p>Changing your password signs out every browser and device.</p>
          <form className="link-form" onSubmit={(event) => void changePassword(event)}>
            <div className="field">
              <label htmlFor="current-password">Current password</label>
              <input
                required
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="new-password">New password</label>
              <input
                required
                id="new-password"
                type="password"
                minLength={15}
                maxLength={128}
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </div>
            {notice && <p className="field-error">{notice}</p>}
            <Button type="submit">Change password</Button>
          </form>
        </article>
      </section>
    </>
  );
}

function LinksPage() {
  const { session } = rootRoute.useRouteContext();
  const search = linksRoute.useSearch();
  const navigate = linksRoute.useNavigate();
  const [searchDraft, setSearchDraft] = useState(search.search ?? "");
  const [collection, setCollection] = useState<"links" | "reserved">("links");
  const links = useInfiniteQuery({
    queryKey: ["links", search],
    queryFn: ({ pageParam }) => apiRequest<Page<LinkDto>>(linkListPath(search, pageParam)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  useEffect(() => {
    setSearchDraft(search.search ?? "");
  }, [search.search]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    void navigate({
      search: {
        ...(searchDraft.trim() ? { search: searchDraft.trim() } : {}),
        state: search.state,
      },
      replace: true,
    });
  }

  function toggleState(state: LinkState) {
    const states = search.state.includes(state)
      ? search.state.filter((candidate) => candidate !== state)
      : [...search.state, state];
    void navigate({
      search: {
        ...(search.search ? { search: search.search } : {}),
        state: states,
      },
      replace: true,
    });
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Links</h1>
          <p>Find and manage every short path in this Instance.</p>
        </div>
        {session.user.role !== "viewer" && (
          <Button
            onClick={() =>
              void navigate({
                to: "/links/new",
                search,
              })
            }
          >
            Create Link
          </Button>
        )}
      </header>
      {session.user.role === "administrator" && (
        <div className="collection-tabs" role="tablist" aria-label="Link collections">
          <Button
            role="tab"
            aria-selected={collection === "links"}
            variant={collection === "links" ? "secondary" : "quiet"}
            onClick={() => setCollection("links")}
          >
            Links
          </Button>
          <Button
            role="tab"
            aria-selected={collection === "reserved"}
            variant={collection === "reserved" ? "secondary" : "quiet"}
            onClick={() => setCollection("reserved")}
          >
            Reserved Aliases
          </Button>
        </div>
      )}
      {collection === "reserved" ? (
        <ReservedAliases />
      ) : (
        <>
          <div className="command-bar">
            <form className="link-search" role="search" onSubmit={submitSearch}>
              <Search aria-hidden="true" size={18} strokeWidth={1.75} />
              <input
                type="search"
                aria-label="Search Links"
                placeholder="Search Alias or title"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
              />
              <Button type="submit" variant="secondary">
                Search
              </Button>
            </form>
            <div className="state-filters" aria-label="Filter by Link state">
              {(["active", "disabled", "archived"] as const).map((state) => (
                <Button
                  key={state}
                  variant={search.state.includes(state) ? "secondary" : "quiet"}
                  aria-pressed={search.state.includes(state)}
                  onClick={() => toggleState(state)}
                >
                  {stateLabel(state)}
                </Button>
              ))}
            </div>
          </div>
          <section aria-label="Link collection" className="collection">
            {links.isPending && <LinkRowsSkeleton />}
            {links.isError && (
              <p className="collection-banner">Links could not be loaded. Try again.</p>
            )}
            {links.data?.pages
              .flatMap((page) => page.items)
              .map((link) => (
                <LinkRow key={link.id} link={link} />
              ))}
          </section>
          {links.hasNextPage && (
            <div className="form-actions">
              <Button
                variant="secondary"
                disabled={links.isFetchingNextPage}
                onClick={() => void links.fetchNextPage()}
              >
                {links.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}
      <Outlet />
    </>
  );
}

function ReservedAliases() {
  const { session, onSession } = rootRoute.useRouteContext();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [selected, setSelected] = useState<ReservedAliasDto>();
  const aliases = useQuery({
    queryKey: ["reserved-aliases", submittedSearch],
    queryFn: () =>
      apiRequest<Page<ReservedAliasDto>>(
        `/api/internal/reserved-aliases${
          submittedSearch ? `?search=${encodeURIComponent(submittedSearch)}` : ""
        }`,
      ),
  });

  return (
    <section className="reserved-collection" aria-label="Reserved Alias collection">
      <form
        className="link-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmittedSearch(search.trim());
        }}
      >
        <Search aria-hidden="true" size={18} strokeWidth={1.75} />
        <input
          type="search"
          aria-label="Search Reserved Aliases"
          placeholder="Search Alias"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <div className="collection">
        {aliases.isPending && <LinkRowsSkeleton />}
        {aliases.data?.items.length === 0 && (
          <div className="empty-state">
            <h2>No Reserved Aliases</h2>
            <p>Permanently deleted Link aliases will be protected here.</p>
          </div>
        )}
        {aliases.data?.items.map((alias) => (
          <article className="link-row reserved-row" key={alias.alias}>
            <div className="link-identity">
              <strong>{alias.alias}</strong>
              <span className="link-route">{alias.shortUrl}</span>
            </div>
            <time dateTime={alias.reservedAt}>
              Reserved{" "}
              {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
                new Date(alias.reservedAt),
              )}
            </time>
            <Button variant="danger" onClick={() => setSelected(alias)}>
              Release Alias
            </Button>
          </article>
        ))}
      </div>
      {selected && (
        <SensitiveAliasDialog
          open
          alias={selected.alias}
          title="Release Reserved Alias"
          description="This makes the Alias available for another Link. This action cannot be undone."
          submitLabel="Release Alias"
          session={session}
          onSession={onSession}
          onClose={() => setSelected(undefined)}
          execute={(csrfToken) =>
            apiRequest<void>(
              `/api/internal/reserved-aliases/${encodeURIComponent(selected.alias)}/release`,
              {
                method: "POST",
                csrfToken,
                body: { confirmationAlias: selected.alias },
              },
            )
          }
          onSuccess={async () => {
            setSelected(undefined);
            await queryClient.invalidateQueries({ queryKey: ["reserved-aliases"] });
          }}
        />
      )}
    </section>
  );
}

function CreateLinkPanel() {
  const { session } = rootRoute.useRouteContext();
  const navigate = createLinkRoute.useNavigate();
  const search = linksRoute.useSearch();
  const queryClient = useQueryClient();
  const [destination, setDestination] = useState("");
  const [title, setTitle] = useState("");
  const [customAlias, setCustomAlias] = useState(false);
  const [alias, setAlias] = useState("");

  const creation = useMutation({
    mutationFn: () =>
      apiRequest<{ ok: true; link: LinkDto }>("/api/internal/links", {
        method: "POST",
        csrfToken: session.csrfToken,
        body: {
          ...(customAlias ? { alias } : {}),
          destination,
          title,
        },
      }),
    onSuccess: async ({ link }) => {
      queryClient.setQueryData(["link", link.id], { ok: true, link });
      await queryClient.invalidateQueries({ queryKey: ["links"] });
      await navigate({
        to: "/links/$linkId",
        params: { linkId: link.id },
        search,
        replace: true,
      });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    creation.mutate();
  }

  return (
    <aside className="detail-panel" aria-label="Create Link panel">
      <div className="detail-panel__header">
        <div>
          <p className="section-label">New short path</p>
          <h2>Create Link</h2>
        </div>
        <Button
          variant="quiet"
          size="icon"
          aria-label="Close Create Link"
          onClick={() => void navigate({ to: "/links", search })}
        >
          <X aria-hidden="true" size={18} strokeWidth={1.75} />
        </Button>
      </div>
      <form className="link-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="create-destination">Destination</label>
          <input
            required
            id="create-destination"
            type="url"
            value={destination}
            placeholder="https://example.com/page"
            aria-describedby="create-destination-help"
            onChange={(event) => setDestination(event.target.value)}
          />
          <span id="create-destination-help">Where this Link sends visitors.</span>
        </div>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={customAlias}
            onChange={(event) => setCustomAlias(event.target.checked)}
          />
          Use a custom Alias
        </label>
        {customAlias ? (
          <div className="field">
            <label htmlFor="create-alias">Alias</label>
            <input
              required
              id="create-alias"
              value={alias}
              autoComplete="off"
              maxLength={64}
              aria-describedby="create-alias-help"
              onChange={(event) => setAlias(event.target.value)}
            />
            <span id="create-alias-help">
              Case-sensitive. Letters, numbers, hyphens, and underscores.
            </span>
          </div>
        ) : (
          <p className="form-note">A six-character Alias will be generated.</p>
        )}
        <div className="field">
          <label htmlFor="create-title">Title</label>
          <input
            required
            id="create-title"
            value={title}
            maxLength={200}
            aria-describedby="create-title-help"
            onChange={(event) => setTitle(event.target.value)}
          />
          <span id="create-title-help">A clear internal name for this Link.</span>
        </div>
        {customAlias && alias && (
          <p className="short-path-preview">
            Short path preview <code>/{alias}</code>
          </p>
        )}
        {creation.isError && <p className="field-error">{linkMutationError(creation.error)}</p>}
        <div className="form-actions">
          <Button
            type="button"
            variant="secondary"
            onClick={() => void navigate({ to: "/links", search })}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={creation.isPending}>
            {creation.isPending ? "Creating…" : "Create Link"}
          </Button>
        </div>
      </form>
    </aside>
  );
}

function LinkDetailPanel() {
  const { session, onSession } = rootRoute.useRouteContext();
  const { linkId } = linkDetailRoute.useParams();
  const navigate = linkDetailRoute.useNavigate();
  const search = linksRoute.useSearch();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [destinationDraft, setDestinationDraft] = useState("");
  const [conflict, setConflict] = useState<LinkDto>();
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState(false);
  const link = useQuery({
    queryKey: ["link", linkId],
    queryFn: () =>
      apiRequest<{ ok: true; link: LinkDto }>(`/api/internal/links/${encodeURIComponent(linkId)}`),
  });
  const versions = useQuery({
    queryKey: ["destination-versions", linkId],
    queryFn: () =>
      apiRequest<Page<DestinationVersionDto> & Readonly<{ currentVersionNumber: number }>>(
        `/api/internal/links/${encodeURIComponent(linkId)}/destination-versions`,
      ),
  });
  const edit = useMutation({
    mutationFn: () =>
      apiRequest<{ ok: true; changed: boolean; link: LinkDto }>(
        `/api/internal/links/${encodeURIComponent(linkId)}`,
        {
          method: "PATCH",
          csrfToken: session.csrfToken,
          body: {
            expectedRevision: link.data?.link.revision,
            title: titleDraft,
            destination: destinationDraft,
          },
        },
      ),
    onSuccess: async ({ link: updatedLink }) => {
      queryClient.setQueryData(["link", linkId], { ok: true, link: updatedLink });
      setConflict(undefined);
      setEditing(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["links"] }),
        queryClient.invalidateQueries({ queryKey: ["destination-versions", linkId] }),
      ]);
    },
    onError: async (error) => {
      if (!(error instanceof ApiError) || error.body.kind !== "link-conflict") return;
      const latest = await apiRequest<{ ok: true; link: LinkDto }>(
        `/api/internal/links/${encodeURIComponent(linkId)}`,
      );
      queryClient.setQueryData(["link", linkId], latest);
      setConflict(latest.link);
    },
  });
  const stateChange = useMutation({
    mutationFn: (command: "activate" | "disable" | "archive" | "restore") =>
      apiRequest<{ ok: true; changed: boolean; link: LinkDto }>(
        `/api/internal/links/${encodeURIComponent(linkId)}/${command}`,
        {
          method: "POST",
          csrfToken: session.csrfToken,
          body: { expectedRevision: link.data?.link.revision },
        },
      ),
    onSuccess: async ({ link: updatedLink }) => {
      queryClient.setQueryData(["link", linkId], { ok: true, link: updatedLink });
      setNotice(`Link ${updatedLink.state === "disabled" ? "disabled" : updatedLink.state}.`);
      await queryClient.invalidateQueries({ queryKey: ["links"] });
    },
  });

  useEffect(() => {
    if (!link.data || editing) return;
    setTitleDraft(link.data.link.title);
    setDestinationDraft(link.data.link.destination.url);
  }, [editing, link.data]);

  useEffect(() => {
    if (!editing || !link.data) return;
    const dirty =
      titleDraft !== link.data.link.title || destinationDraft !== link.data.link.destination.url;
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [destinationDraft, editing, link.data, titleDraft]);

  function beginEditing() {
    if (!link.data) return;
    setTitleDraft(link.data.link.title);
    setDestinationDraft(link.data.link.destination.url);
    setConflict(undefined);
    setEditing(true);
  }

  function submitEdit(event: FormEvent) {
    event.preventDefault();
    edit.mutate();
  }

  function discardMine() {
    setConflict(undefined);
    setEditing(false);
  }

  function closeDetail() {
    const dirty =
      editing &&
      link.data &&
      (titleDraft !== link.data.link.title || destinationDraft !== link.data.link.destination.url);
    if (dirty && !window.confirm("Discard your unsaved changes?")) return;
    void navigate({ to: "/links", search });
  }

  return (
    <aside className="detail-panel" aria-label="Link detail">
      {link.isPending && <p aria-busy="true">Loading Link…</p>}
      {link.isError && <p className="collection-banner">This Link could not be loaded.</p>}
      {link.data && (
        <>
          <div className="detail-panel__header">
            <div>
              <StatusChip state={link.data.link.state} />
              <h2>{link.data.link.title}</h2>
            </div>
            <div className="detail-panel__actions">
              {!editing &&
                session.user.role !== "viewer" &&
                link.data.link.state !== "archived" && (
                  <Button variant="secondary" onClick={beginEditing}>
                    Edit Link
                  </Button>
                )}
              <Button
                variant="quiet"
                size="icon"
                aria-label="Close Link detail"
                onClick={closeDetail}
              >
                <X aria-hidden="true" size={18} strokeWidth={1.75} />
              </Button>
            </div>
          </div>
          {editing ? (
            <form className="link-form" onSubmit={submitEdit}>
              {conflict && (
                <section className="conflict-panel" role="alert">
                  <h3>Link changed elsewhere</h3>
                  <p>
                    Your values are preserved. Compare them with the current Link before deciding
                    what to keep.
                  </p>
                  <div className="conflict-comparison">
                    {titleDraft !== conflict.title && (
                      <div>
                        <span>Current Title</span>
                        <strong>{conflict.title}</strong>
                        <span>Your Title</span>
                        <strong>{titleDraft}</strong>
                      </div>
                    )}
                    {destinationDraft !== conflict.destination.url && (
                      <div>
                        <span>Current Destination</span>
                        <code>{conflict.destination.url}</code>
                        <span>Your Destination</span>
                        <code>{destinationDraft}</code>
                      </div>
                    )}
                  </div>
                  <div className="form-actions">
                    <Button type="button" variant="secondary">
                      Review changes
                    </Button>
                    <Button type="button" variant="quiet" onClick={discardMine}>
                      Discard mine
                    </Button>
                  </div>
                </section>
              )}
              <div className="field">
                <label htmlFor="edit-title">Title</label>
                <input
                  required
                  id="edit-title"
                  value={titleDraft}
                  maxLength={200}
                  onChange={(event) => setTitleDraft(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="edit-destination">Destination</label>
                <input
                  required
                  id="edit-destination"
                  type="url"
                  value={destinationDraft}
                  onChange={(event) => setDestinationDraft(event.target.value)}
                />
              </div>
              <p className="form-note">
                Alias <code>{link.data.link.alias}</code> is the stable identity and cannot be
                edited.
              </p>
              {edit.isError &&
                (!(edit.error instanceof ApiError) || edit.error.body.kind !== "link-conflict") && (
                  <p className="field-error">{linkMutationError(edit.error)}</p>
                )}
              <div className="form-actions">
                <Button type="button" variant="secondary" onClick={discardMine}>
                  Cancel
                </Button>
                <Button type="submit" disabled={edit.isPending}>
                  {edit.isPending ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </form>
          ) : (
            <>
              <section className="detail-section">
                <h3>Identity</h3>
                <dl>
                  <div>
                    <dt>Short URL</dt>
                    <dd>
                      <code>{link.data.link.shortUrl}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Alias</dt>
                    <dd>
                      <code>{link.data.link.alias}</code>
                    </dd>
                  </div>
                </dl>
              </section>
              <section className="detail-section">
                <h3>Current Destination</h3>
                <a href={link.data.link.destination.url} target="_blank" rel="noreferrer">
                  {link.data.link.destination.url}
                </a>
              </section>
              <section className="detail-section">
                <h3>Destination Versions</h3>
                {versions.isPending && <p>Loading versions…</p>}
                {versions.data?.items.length === 0 && (
                  <p>Earlier Destination Versions will appear here after the first edit.</p>
                )}
                {versions.data?.items.map((version) => (
                  <div className="version-row" key={version.id}>
                    <strong>Version {version.versionNumber}</strong>
                    <span>{version.url}</span>
                  </div>
                ))}
              </section>
              {session.user.role !== "viewer" && (
                <section className="detail-section">
                  <h3>Link state</h3>
                  {notice && (
                    <p className="success" role="status">
                      {notice}
                    </p>
                  )}
                  {stateChange.isError && (
                    <p className="field-error">The Link state could not be changed.</p>
                  )}
                  <div className="form-actions">
                    {link.data.link.state === "active" && (
                      <>
                        <Button variant="secondary" onClick={() => stateChange.mutate("disable")}>
                          Disable Link
                        </Button>
                        <Button variant="danger" onClick={() => stateChange.mutate("archive")}>
                          Archive Link
                        </Button>
                      </>
                    )}
                    {link.data.link.state === "disabled" && (
                      <>
                        <Button onClick={() => stateChange.mutate("activate")}>
                          Activate Link
                        </Button>
                        <Button variant="danger" onClick={() => stateChange.mutate("archive")}>
                          Archive Link
                        </Button>
                      </>
                    )}
                    {link.data.link.state === "archived" && (
                      <>
                        <Button onClick={() => stateChange.mutate("restore")}>Restore Link</Button>
                        {session.user.role === "administrator" && (
                          <Button variant="danger" onClick={() => setDeleting(true)}>
                            <Trash2 aria-hidden="true" size={16} strokeWidth={1.75} />
                            Permanently delete
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </section>
              )}
              {deleting && (
                <SensitiveAliasDialog
                  open
                  alias={link.data.link.alias}
                  title="Permanently delete Link"
                  description="The Link and Destination history will be deleted. Its Alias remains reserved until an Administrator releases it."
                  submitLabel="Permanently delete"
                  session={session}
                  onSession={onSession}
                  onClose={() => setDeleting(false)}
                  execute={(csrfToken) =>
                    apiRequest<{ ok: true; reservedAlias: ReservedAliasDto }>(
                      `/api/internal/links/${encodeURIComponent(linkId)}/permanently-delete`,
                      {
                        method: "POST",
                        csrfToken,
                        body: {
                          expectedRevision: link.data.link.revision,
                          confirmationAlias: link.data.link.alias,
                        },
                      },
                    )
                  }
                  onSuccess={async () => {
                    setDeleting(false);
                    await Promise.all([
                      queryClient.invalidateQueries({ queryKey: ["links"] }),
                      queryClient.invalidateQueries({ queryKey: ["reserved-aliases"] }),
                    ]);
                    await navigate({ to: "/links", search, replace: true });
                  }}
                />
              )}
            </>
          )}
        </>
      )}
    </aside>
  );
}

function SensitiveAliasDialog({
  open,
  alias,
  title,
  description,
  submitLabel,
  session,
  onSession,
  onClose,
  execute,
  onSuccess,
}: Readonly<{
  open: boolean;
  alias: string;
  title: string;
  description: string;
  submitLabel: string;
  session: Session;
  onSession: (session: Session | undefined) => void;
  onClose: () => void;
  execute: (csrfToken: string) => Promise<unknown>;
  onSuccess: () => Promise<void>;
}>) {
  const [confirmation, setConfirmation] = useState("");
  const [password, setPassword] = useState("");
  const [csrfToken, setCsrfToken] = useState(session.csrfToken);
  const [needsReauthentication, setNeedsReauthentication] = useState(false);
  const [verified, setVerified] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (needsReauthentication) {
      setPending(true);
      try {
        const refreshed = await apiRequest<{ ok: true; user: Session["user"]; csrfToken: string }>(
          "/api/internal/auth/reauthenticate",
          {
            method: "POST",
            csrfToken,
            body: { password },
          },
        );
        const nextSession = { user: refreshed.user, csrfToken: refreshed.csrfToken };
        setCsrfToken(refreshed.csrfToken);
        onSession(nextSession);
        setNeedsReauthentication(false);
        setVerified(true);
        setPassword("");
      } catch {
        setError("The password is incorrect.");
      } finally {
        setPending(false);
      }
      return;
    }

    setPending(true);
    try {
      await execute(csrfToken);
      await onSuccess();
    } catch (caught) {
      if (caught instanceof ApiError && caught.body.kind === "reauthentication-required") {
        setNeedsReauthentication(true);
        setError("");
      } else if (caught instanceof ApiError && caught.body.kind === "confirmation-mismatch") {
        setError("The Alias does not match.");
      } else {
        setError("The action could not be completed.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
      title={title}
      description={description}
    >
      <form className="link-form" onSubmit={(event) => void submit(event)}>
        {needsReauthentication ? (
          <div className="field">
            <label htmlFor="sensitive-password">Current password</label>
            <input
              required
              id="sensitive-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <span>Verify your password to continue. The action will not run automatically.</span>
          </div>
        ) : (
          <div className="field">
            <label htmlFor="alias-confirmation">
              Type <code>{alias}</code> to confirm
            </label>
            <input
              required
              id="alias-confirmation"
              autoComplete="off"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </div>
        )}
        {verified && (
          <p className="notice" role="status">
            Password verified. Submit the action again to continue.
          </p>
        )}
        {error && <p className="field-error">{error}</p>}
        <Button
          type="submit"
          variant="danger"
          disabled={
            pending || (needsReauthentication ? password.length === 0 : confirmation !== alias)
          }
        >
          {needsReauthentication
            ? pending
              ? "Verifying…"
              : "Verify password"
            : pending
              ? "Working…"
              : submitLabel}
        </Button>
      </form>
    </Dialog>
  );
}

function LinkRow({ link }: Readonly<{ link: LinkDto }>) {
  const [copied, setCopied] = useState(false);
  const search = linksRoute.useSearch();

  async function copyShortUrl() {
    await navigator.clipboard.writeText(link.shortUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  }

  return (
    <article className="link-row">
      <span className={`status-chip status-chip--${link.state}`}>
        <StatusIcon state={link.state} />
        {stateLabel(link.state)}
      </span>
      <div className="link-identity">
        <strong>
          <Link
            to="/links/$linkId"
            params={{ linkId: link.id }}
            search={search}
            aria-label={`Open ${link.title}`}
          >
            {link.title}
          </Link>
        </strong>
        <span className="link-route">{link.shortUrl}</span>
        <span className="link-destination">{link.destination.url}</span>
      </div>
      <time dateTime={link.updatedAt}>
        {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
          new Date(link.updatedAt),
        )}
      </time>
      <Button
        variant="quiet"
        size="icon"
        aria-label={`${copied ? "Copied" : "Copy"} short URL for ${link.title}`}
        onClick={() => void copyShortUrl()}
      >
        <Copy aria-hidden="true" size={16} strokeWidth={1.75} />
        <span className="copy-label" aria-hidden="true">
          {copied ? "Copied" : "Copy"}
        </span>
      </Button>
    </article>
  );
}

function StatusChip({ state }: Readonly<{ state: LinkState }>) {
  return (
    <span className={`status-chip status-chip--${state}`}>
      <StatusIcon state={state} />
      {stateLabel(state)}
    </span>
  );
}

function StatusIcon({ state }: Readonly<{ state: LinkState }>) {
  const Icon = {
    active: CheckCircle2,
    disabled: PauseCircle,
    archived: Archive,
  }[state];
  return <Icon aria-hidden="true" size={14} strokeWidth={1.75} />;
}

function StatusChipForUser({ state }: Readonly<{ state: Session["user"]["state"] }>) {
  return <span className={`status-chip status-chip--${state}`}>{state}</span>;
}

function LinkRowsSkeleton() {
  return (
    <div className="link-row-skeletons" aria-label="Loading Links">
      <div />
      <div />
      <div />
    </div>
  );
}

function linkListPath(search: LinkSearch, cursor?: string) {
  const parameters = new URLSearchParams();
  if (search.search) parameters.set("search", search.search);
  for (const state of search.state) parameters.append("state", state);
  if (cursor) parameters.set("cursor", cursor);
  const query = parameters.toString();
  return `/api/internal/links${query ? `?${query}` : ""}`;
}

function parseStates(value: unknown): readonly LinkState[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return values.filter(
    (state): state is LinkState =>
      state === "active" || state === "disabled" || state === "archived",
  );
}

function stateLabel(state: LinkState) {
  return {
    active: "Active",
    disabled: "Disabled",
    archived: "Archived",
  }[state];
}

function roleLabel(role: Session["user"]["role"]) {
  return {
    administrator: "Administrator",
    member: "Member",
    viewer: "Viewer",
  }[role];
}

function readTheme(): Theme {
  const stored = window.localStorage.getItem("shortflare-theme");
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

function linkMutationError(error: Error) {
  if (!(error instanceof ApiError)) return "The Link could not be saved.";
  return (
    {
      "alias-in-use": "That Alias already belongs to another Link.",
      "alias-reserved": "That Alias is reserved and cannot be reused.",
      "invalid-alias": "Use 1–64 letters, numbers, hyphens, or underscores.",
      "invalid-destination": "Enter a safe HTTP or HTTPS Destination.",
      "invalid-title": "Enter a title between 1 and 200 characters.",
    }[error.body.kind] ?? "The Link could not be saved."
  );
}
