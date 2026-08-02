import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Outlet } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useState } from "react";

import { jsonRequest, noContentRequest } from "../../api";
import { linksPageResponseSchema, reservedAliasesPageResponseSchema } from "../../api-schemas";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import type { LinkState, ReservedAliasDto } from "../../types";
import { LinkRow } from "./link-row";
import { formatDate, LinkRowsSkeleton, stateLabel } from "./link-presentation";
import { linkListPath } from "./route-search";
import { SensitiveAliasDialog } from "./sensitive-alias-dialog";

const rootApi = getRouteApi("__root__");
const linksApi = getRouteApi("/links");

export function LinksPage() {
  const { session } = rootApi.useRouteContext();
  const search = linksApi.useSearch();
  const navigate = linksApi.useNavigate();
  const [collection, setCollection] = useState<"links" | "reserved">("links");
  const links = useInfiniteQuery({
    queryKey: ["links", search],
    queryFn: ({ pageParam }) =>
      jsonRequest(linkListPath(search, pageParam), linksPageResponseSchema),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  function submitSearch(searchDraft: string) {
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
      <header className="mb-7 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Links</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Find and manage every short path in this Instance.
          </p>
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
        <div
          className="flex w-fit gap-1 rounded-lg border bg-card p-1"
          role="tablist"
          aria-label="Link collections"
        >
          <Button
            role="tab"
            aria-selected={collection === "links"}
            variant={collection === "links" ? "secondary" : "ghost"}
            onClick={() => setCollection("links")}
          >
            Links
          </Button>
          <Button
            role="tab"
            aria-selected={collection === "reserved"}
            variant={collection === "reserved" ? "secondary" : "ghost"}
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
          <div className="my-4 flex flex-col items-stretch justify-between gap-3 md:flex-row md:items-center">
            <LinkSearchForm
              key={search.search ?? ""}
              initialSearch={search.search ?? ""}
              onSearch={submitSearch}
            />
            <div className="flex gap-1 overflow-x-auto" aria-label="Filter by Link state">
              {(["active", "disabled", "archived"] as const).map((state) => (
                <Button
                  key={state}
                  variant={search.state.includes(state) ? "secondary" : "ghost"}
                  aria-pressed={search.state.includes(state)}
                  onClick={() => toggleState(state)}
                >
                  {stateLabel(state)}
                </Button>
              ))}
            </div>
          </div>
          <section aria-label="Link collection" className="border-t">
            {links.isPending && <LinkRowsSkeleton />}
            {links.isError && (
              <p className="rounded-lg border bg-muted p-4 text-sm">
                Links could not be loaded. Try again.
              </p>
            )}
            {links.data?.pages.flatMap((page) => page.items).length === 0 && (
              <div className="mx-auto my-8 rounded-lg border bg-card p-6 text-center">
                <h2 className="text-lg font-semibold tracking-tight">
                  {search.search || search.state.length ? "No matching Links" : "No Links yet"}
                </h2>
                <p className="mt-2 mb-4 text-sm text-muted-foreground">
                  {search.search || search.state.length
                    ? "Try a different search or state filter."
                    : "Create the first Link to begin shortening paths."}
                </p>
                {search.search || search.state.length ? (
                  <Button
                    variant="secondary"
                    onClick={() => void navigate({ search: { state: [] }, replace: true })}
                  >
                    Clear filters
                  </Button>
                ) : (
                  session.user.role !== "viewer" && (
                    <Button
                      onClick={() => void navigate({ to: "/links/new", search: { state: [] } })}
                    >
                      Create Link
                    </Button>
                  )
                )}
              </div>
            )}
            {links.data?.pages
              .flatMap((page) => page.items)
              .map((link) => (
                <LinkRow key={link.id} link={link} />
              ))}
          </section>
          {links.hasNextPage && (
            <div className="mt-4 flex flex-wrap justify-end gap-3">
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

function LinkSearchForm({
  initialSearch,
  onSearch,
}: {
  initialSearch: string;
  onSearch: (search: string) => void;
}) {
  const [search, setSearch] = useState(initialSearch);

  return (
    <form
      className="flex w-full max-w-lg items-center gap-2 rounded-lg border border-input bg-card p-1.5"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(search);
      }}
    >
      <Search
        className="ml-1 text-muted-foreground"
        aria-hidden="true"
        size={18}
        strokeWidth={1.75}
      />
      <Input
        className="border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
        type="search"
        aria-label="Search Links"
        placeholder="Search Alias or title"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <Button type="submit" variant="secondary">
        Search
      </Button>
    </form>
  );
}

function ReservedAliases() {
  const { session, onSession } = rootApi.useRouteContext();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [selected, setSelected] = useState<ReservedAliasDto>();
  const aliases = useInfiniteQuery({
    queryKey: ["reserved-aliases", submittedSearch],
    queryFn: ({ pageParam }) =>
      jsonRequest(
        `/api/internal/reserved-aliases${
          submittedSearch || pageParam
            ? `?${new URLSearchParams({
                ...(submittedSearch ? { search: submittedSearch } : {}),
                ...(pageParam ? { cursor: pageParam } : {}),
              })}`
            : ""
        }`,
        reservedAliasesPageResponseSchema,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  return (
    <section className="mt-4" aria-label="Reserved Alias collection">
      <form
        className="flex w-full max-w-lg items-center gap-2 rounded-lg border border-input bg-card p-1.5"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmittedSearch(search.trim());
        }}
      >
        <Search
          className="ml-1 text-muted-foreground"
          aria-hidden="true"
          size={18}
          strokeWidth={1.75}
        />
        <Input
          className="border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
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
      <div className="mt-4 border-t">
        {aliases.isPending && <LinkRowsSkeleton />}
        {aliases.data?.pages.flatMap((page) => page.items).length === 0 && (
          <div className="mx-auto my-8 rounded-lg border bg-card p-6 text-center">
            <h2 className="text-lg font-semibold tracking-tight">No Reserved Aliases</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Permanently deleted Link aliases will be protected here.
            </p>
          </div>
        )}
        {aliases.data?.pages
          .flatMap((page) => page.items)
          .map((alias) => (
            <article
              className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b px-3 py-4 md:grid-cols-[minmax(0,1fr)_auto_auto]"
              key={alias.alias}
            >
              <div className="grid min-w-0 gap-1">
                <strong>{alias.alias}</strong>
                <span className="font-mono text-xs font-semibold text-primary">
                  {alias.shortUrl}
                </span>
              </div>
              <time
                className="hidden text-xs text-muted-foreground md:block"
                dateTime={alias.reservedAt}
              >
                Reserved {formatDate(alias.reservedAt)}
              </time>
              <Button variant="destructive" onClick={() => setSelected(alias)}>
                Release Alias
              </Button>
            </article>
          ))}
      </div>
      {aliases.hasNextPage && (
        <div className="mt-4 flex flex-wrap justify-end gap-3">
          <Button
            variant="secondary"
            disabled={aliases.isFetchingNextPage}
            onClick={() => void aliases.fetchNextPage()}
          >
            {aliases.isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
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
            noContentRequest(
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
