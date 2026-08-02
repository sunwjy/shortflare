import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { X } from "lucide-react";
import { type FormEvent, useState } from "react";

import { ApiError, jsonRequest } from "../../api";
import { linkResponseSchema } from "../../api-schemas";
import { Button } from "../../components/ui/button";

const rootApi = getRouteApi("__root__");
const linksApi = getRouteApi("/links");
const createLinkApi = getRouteApi("/links/new");

export function CreateLinkPanel() {
  const { session } = rootApi.useRouteContext();
  const navigate = createLinkApi.useNavigate();
  const search = linksApi.useSearch();
  const queryClient = useQueryClient();
  const [destination, setDestination] = useState("");
  const [title, setTitle] = useState("");
  const [customAlias, setCustomAlias] = useState(false);
  const [alias, setAlias] = useState("");

  const creation = useMutation({
    mutationFn: () =>
      jsonRequest("/api/internal/links", linkResponseSchema, {
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

export function linkMutationError(error: Error) {
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
