import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useBlocker } from "@tanstack/react-router";
import { Trash2, X } from "lucide-react";
import { type FormEvent, useState } from "react";

import { ApiError, jsonRequest } from "../../api";
import {
  deletedLinkResponseSchema,
  destinationVersionsPageResponseSchema,
  linkMutationResponseSchema,
  linkResponseSchema,
} from "../../api-schemas";
import { Button } from "../../components/ui/button";
import type { LinkDto } from "../../types";
import { linkMutationError } from "./create-link-panel";
import { StatusChip } from "./link-presentation";
import { SensitiveAliasDialog } from "./sensitive-alias-dialog";

const rootApi = getRouteApi("__root__");
const linksApi = getRouteApi("/links");
const linkDetailApi = getRouteApi("/links/$linkId");

export function LinkDetailPanel() {
  const { session, onSession } = rootApi.useRouteContext();
  const { linkId } = linkDetailApi.useParams();
  const navigate = linkDetailApi.useNavigate();
  const search = linksApi.useSearch();
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
    mutationFn: () =>
      jsonRequest(`/api/internal/links/${encodeURIComponent(linkId)}`, linkMutationResponseSchema, {
        method: "PATCH",
        csrfToken: session.csrfToken,
        body: {
          expectedRevision: link.data?.link.revision,
          title: titleDraft,
          destination: destinationDraft,
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
      const latest = await jsonRequest(
        `/api/internal/links/${encodeURIComponent(linkId)}`,
        linkResponseSchema,
      );
      queryClient.setQueryData(["link", linkId], latest);
      setConflict(latest.link);
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

  const dirty =
    Boolean(editing && link.data) &&
    (titleDraft !== link.data?.link.title || destinationDraft !== link.data?.link.destination.url);
  useBlocker({
    disabled: !dirty,
    enableBeforeUnload: dirty,
    shouldBlockFn: () => !window.confirm("Discard your unsaved changes?"),
  });

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
    void navigate({ to: "/links", search });
  }

  function reviewChanges() {
    const field = conflict && titleDraft !== conflict.title ? "edit-title" : "edit-destination";
    document.getElementById(field)?.focus();
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
                    <Button type="button" variant="secondary" onClick={reviewChanges}>
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
                {versions.data?.pages.flatMap((page) => page.items).length === 0 && (
                  <p>Earlier Destination Versions will appear here after the first edit.</p>
                )}
                {versions.data?.pages
                  .flatMap((page) => page.items)
                  .map((version) => (
                    <div className="version-row" key={version.id}>
                      <strong>Version {version.versionNumber}</strong>
                      <span>{version.url}</span>
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
