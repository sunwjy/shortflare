import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-form";
import { getRouteApi, useBlocker } from "@tanstack/react-router";
import { Trash2, X } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { ApiError, jsonRequest } from "../../api";
import {
  deletedLinkResponseSchema,
  destinationVersionsPageResponseSchema,
  linkMutationResponseSchema,
  linkResponseSchema,
} from "../../api-schemas";
import { useAppForm } from "../../components/form/app-form";
import { destinationSchema, linkTitleSchema } from "../../components/form/form-schemas";
import { Button } from "../../components/ui/button";
import type { LinkDto } from "../../types";
import { AnalyticsDashboard } from "../analytics/analytics-page";
import { normalizeAnalyticsSearch } from "../analytics/analytics-range";
import { linkMutationError } from "./create-link-panel";
import { StatusChip } from "./link-presentation";
import { SensitiveAliasDialog } from "./sensitive-alias-dialog";

const rootApi = getRouteApi("__root__");
const linksApi = getRouteApi("/links");
const linkDetailApi = getRouteApi("/links/$linkId");
const editLinkSchema = z.object({ title: linkTitleSchema, destination: destinationSchema });

export function LinkDetailPanel() {
  const { session, onSession } = rootApi.useRouteContext();
  const { linkId } = linkDetailApi.useParams();
  const navigate = linkDetailApi.useNavigate();
  const search = linksApi.useSearch();
  const detailSearch = linkDetailApi.useSearch();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [conflict, setConflict] = useState<LinkDto>();
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState(false);
  const link = useQuery({
    queryKey: ["link", linkId],
    queryFn: () =>
      jsonRequest(`/api/internal/links/${encodeURIComponent(linkId)}`, linkResponseSchema),
  });
  const versions = useInfiniteQuery({
    queryKey: ["destination-versions", linkId],
    queryFn: ({ pageParam }) =>
      jsonRequest(
        `/api/internal/links/${encodeURIComponent(linkId)}/destination-versions${
          pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""
        }`,
        destinationVersionsPageResponseSchema,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const edit = useMutation({
    mutationFn: (draft: { title: string; destination: string }) =>
      jsonRequest(`/api/internal/links/${encodeURIComponent(linkId)}`, linkMutationResponseSchema, {
        method: "PATCH",
        csrfToken: session.csrfToken,
        body: {
          expectedRevision: link.data?.link.revision,
          title: draft.title,
          destination: draft.destination,
        },
      }),
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
      if (!(error instanceof ApiError) || error.body.kind !== "link-conflict") {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["link", linkId] }),
          queryClient.invalidateQueries({ queryKey: ["destination-versions", linkId] }),
        ]);
        return;
      }
      // Preserve the User's drafts and replace only the server snapshot so the
      // conflict remains an explicit review instead of an implicit merge.
      const latest = await jsonRequest(
        `/api/internal/links/${encodeURIComponent(linkId)}`,
        linkResponseSchema,
      );
      queryClient.setQueryData(["link", linkId], latest);
      setConflict(latest.link);
    },
  });
  const form = useAppForm({
    defaultValues: { title: "", destination: "" },
    validators: {
      onBlur: editLinkSchema,
      onChange: editLinkSchema,
      onSubmit: editLinkSchema,
    },
    onSubmit: async ({ value }) => {
      await edit.mutateAsync(value).catch(() => undefined);
    },
  });
  const stateChange = useMutation({
    mutationFn: (command: "activate" | "disable" | "archive" | "restore") =>
      jsonRequest(
        `/api/internal/links/${encodeURIComponent(linkId)}/${command}`,
        linkMutationResponseSchema,
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
    onError: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["link", linkId] }),
        queryClient.invalidateQueries({ queryKey: ["links"] }),
      ]);
    },
  });

  const formDirty = useStore(form.store, (state) => state.isDirty);
  const drafts = useStore(form.store, (state) => state.values);
  const dirty = Boolean(editing && link.data && formDirty);
  useBlocker({
    disabled: !dirty,
    enableBeforeUnload: dirty,
    shouldBlockFn: () => !window.confirm("Discard your unsaved changes?"),
  });

  function beginEditing() {
    if (!link.data) return;
    form.reset({
      title: link.data.link.title,
      destination: link.data.link.destination.url,
    });
    setConflict(undefined);
    setEditing(true);
  }

  function discardMine() {
    setConflict(undefined);
    setEditing(false);
  }

  function closeDetail() {
    void navigate({ to: "/links", search });
  }

  function reviewChanges() {
    const field = conflict && drafts.title !== conflict.title ? "title" : "destination";
    document.getElementById(field)?.focus();
  }

  return (
    <aside
      className="fixed inset-0 z-20 overflow-auto bg-card p-6 text-card-foreground shadow-2xl md:inset-y-0 md:right-0 md:left-auto md:w-full md:max-w-4xl md:border-l"
      aria-label="Link detail"
    >
      {link.isPending && <p aria-busy="true">Loading Link…</p>}
      {link.isError && (
        <p className="rounded-lg border bg-muted p-4 text-sm">This Link could not be loaded.</p>
      )}
      {link.data && (
        <>
          <div className="mb-7 flex items-start justify-between gap-3">
            <div>
              <StatusChip state={link.data.link.state} />
              <h2 className="mt-2 text-xl font-semibold tracking-tight">{link.data.link.title}</h2>
            </div>
            <div className="flex items-center gap-3">
              {!editing &&
                session.user.role !== "viewer" &&
                link.data.link.state !== "archived" && (
                  <Button variant="secondary" onClick={beginEditing}>
                    Edit Link
                  </Button>
                )}
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close Link detail"
                onClick={closeDetail}
              >
                <X aria-hidden="true" size={18} strokeWidth={1.75} />
              </Button>
            </div>
          </div>
          {editing ? (
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void form.handleSubmit();
              }}
            >
              {conflict && (
                <section
                  className="rounded-lg border border-warning bg-warning-soft p-4"
                  role="alert"
                >
                  <h3 className="font-semibold">Link changed elsewhere</h3>
                  <p className="mt-2 text-sm">
                    Your values are preserved. Compare them with the current Link before deciding
                    what to keep.
                  </p>
                  <div className="mt-4 grid gap-3">
                    {drafts.title !== conflict.title && (
                      <div className="grid gap-1">
                        <span className="text-xs text-muted-foreground">Current Title</span>
                        <strong>{conflict.title}</strong>
                        <span className="text-xs text-muted-foreground">Your Title</span>
                        <strong>{drafts.title}</strong>
                      </div>
                    )}
                    {drafts.destination !== conflict.destination.url && (
                      <div className="grid gap-1">
                        <span className="text-xs text-muted-foreground">Current Destination</span>
                        <code>{conflict.destination.url}</code>
                        <span className="text-xs text-muted-foreground">Your Destination</span>
                        <code>{drafts.destination}</code>
                      </div>
                    )}
                  </div>
                  <div className="mt-4 flex flex-wrap justify-end gap-3">
                    <Button type="button" variant="secondary" onClick={reviewChanges}>
                      Review changes
                    </Button>
                    <Button type="button" variant="ghost" onClick={discardMine}>
                      Discard mine
                    </Button>
                  </div>
                </section>
              )}
              <form.AppField name="title">
                {(field) => <field.TextField label="Title" maxLength={200} />}
              </form.AppField>
              <form.AppField name="destination">
                {(field) => <field.TextField label="Destination" type="url" />}
              </form.AppField>
              <p className="text-xs text-muted-foreground">
                Alias <code>{link.data.link.alias}</code> is the stable identity and cannot be
                edited.
              </p>
              {edit.isError &&
                (!(edit.error instanceof ApiError) || edit.error.body.kind !== "link-conflict") && (
                  <p className="text-sm text-destructive" role="alert">
                    {linkMutationError(edit.error)}
                  </p>
                )}
              <div className="flex flex-wrap justify-end gap-3">
                <Button type="button" variant="secondary" onClick={discardMine}>
                  Cancel
                </Button>
                <form.AppForm>
                  <form.SubmitButton pendingLabel="Saving…">Save changes</form.SubmitButton>
                </form.AppForm>
              </div>
            </form>
          ) : (
            <>
              <section className="border-t py-5">
                <h3 className="mb-3 text-sm font-semibold">Identity</h3>
                <dl className="grid gap-3">
                  <div className="grid gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4">
                    <dt className="text-xs text-muted-foreground">Short URL</dt>
                    <dd className="m-0 break-words">
                      <code>{link.data.link.shortUrl}</code>
                    </dd>
                  </div>
                  <div className="grid gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4">
                    <dt className="text-xs text-muted-foreground">Alias</dt>
                    <dd className="m-0 break-words">
                      <code>{link.data.link.alias}</code>
                    </dd>
                  </div>
                </dl>
              </section>
              <section className="border-t py-5">
                <h3 className="mb-3 text-sm font-semibold">Current Destination</h3>
                <a
                  className="break-words text-primary hover:underline"
                  href={link.data.link.destination.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {link.data.link.destination.url}
                </a>
              </section>
              <section className="border-t py-5">
                <h3 className="mb-4 text-sm font-semibold">Analytics</h3>
                <AnalyticsDashboard
                  scope={{ kind: "link", linkId }}
                  search={normalizeAnalyticsSearch(detailSearch)}
                  onSearch={(next) => navigate({ search: { ...search, ...next } })}
                />
              </section>
              <section className="border-t py-5">
                <h3 className="mb-3 text-sm font-semibold">Destination Versions</h3>
                {versions.isPending && <p>Loading versions…</p>}
                {versions.data?.pages.flatMap((page) => page.items).length === 0 && (
                  <p>Earlier Destination Versions will appear here after the first edit.</p>
                )}
                {versions.data?.pages
                  .flatMap((page) => page.items)
                  .map((version) => (
                    <div className="grid gap-1 py-3" key={version.id}>
                      <strong>Version {version.versionNumber}</strong>
                      <span className="truncate text-xs text-muted-foreground">{version.url}</span>
                    </div>
                  ))}
                {versions.hasNextPage && (
                  <Button
                    variant="secondary"
                    disabled={versions.isFetchingNextPage}
                    onClick={() => void versions.fetchNextPage()}
                  >
                    {versions.isFetchingNextPage ? "Loading…" : "Load more Versions"}
                  </Button>
                )}
              </section>
              {session.user.role !== "viewer" && (
                <section className="border-t py-5">
                  <h3 className="mb-3 text-sm font-semibold">Link state</h3>
                  {notice && (
                    <p className="text-sm text-success" role="status">
                      {notice}
                    </p>
                  )}
                  {stateChange.isError && (
                    <p className="text-sm text-destructive" role="alert">
                      The Link state could not be changed.
                    </p>
                  )}
                  <div className="flex flex-wrap justify-end gap-3">
                    {link.data.link.state === "active" && (
                      <>
                        <Button variant="secondary" onClick={() => stateChange.mutate("disable")}>
                          Disable Link
                        </Button>
                        <Button variant="secondary" onClick={() => stateChange.mutate("archive")}>
                          Archive Link
                        </Button>
                      </>
                    )}
                    {link.data.link.state === "disabled" && (
                      <>
                        <Button onClick={() => stateChange.mutate("activate")}>
                          Activate Link
                        </Button>
                        <Button variant="secondary" onClick={() => stateChange.mutate("archive")}>
                          Archive Link
                        </Button>
                      </>
                    )}
                    {link.data.link.state === "archived" && (
                      <>
                        <Button onClick={() => stateChange.mutate("restore")}>Restore Link</Button>
                        {session.user.role === "administrator" && (
                          <Button variant="destructive" onClick={() => setDeleting(true)}>
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
                  description="The Link and its Destination Versions will be deleted. Its Alias remains reserved until an Administrator releases it."
                  submitLabel="Permanently delete"
                  session={session}
                  onSession={onSession}
                  onClose={() => setDeleting(false)}
                  execute={(csrfToken) =>
                    jsonRequest(
                      `/api/internal/links/${encodeURIComponent(linkId)}/permanently-delete`,
                      deletedLinkResponseSchema,
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
