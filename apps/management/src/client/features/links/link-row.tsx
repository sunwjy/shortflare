import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useMatchRoute } from "@tanstack/react-router";
import { Copy, MoreHorizontal } from "lucide-react";
import { useState } from "react";

import { jsonRequest } from "../../api";
import { linkMutationResponseSchema } from "../../api-schemas";
import { Button } from "../../components/ui/button";
import type { LinkDto } from "../../types";
import { formatDate, middleTruncate, StatusChip } from "./link-presentation";

const rootApi = getRouteApi("__root__");
const linksApi = getRouteApi("/links");

export function LinkRow({ link }: Readonly<{ link: LinkDto }>) {
  const { session } = rootApi.useRouteContext();
  const [copied, setCopied] = useState(false);
  const search = linksApi.useSearch();
  const queryClient = useQueryClient();
  const matchRoute = useMatchRoute();
  const selected = Boolean(
    matchRoute({ to: "/links/$linkId", params: { linkId: link.id }, fuzzy: false }),
  );

  async function copyShortUrl() {
    await navigator.clipboard.writeText(link.shortUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  }

  const stateChange = useMutation({
    mutationFn: (command: "activate" | "disable" | "archive" | "restore") =>
      jsonRequest(
        `/api/internal/links/${encodeURIComponent(link.id)}/${command}`,
        linkMutationResponseSchema,
        {
          method: "POST",
          csrfToken: session.csrfToken,
          body: { expectedRevision: link.revision },
        },
      ),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["links"] });
    },
  });

  const rowCommands: readonly (readonly [
    "activate" | "disable" | "archive" | "restore",
    string,
  ])[] =
    link.state === "active"
      ? [
          ["disable", "Disable Link"],
          ["archive", "Archive Link"],
        ]
      : link.state === "disabled"
        ? [
            ["activate", "Activate Link"],
            ["archive", "Archive Link"],
          ]
        : [["restore", "Restore Link"]];

  return (
    <article className={`link-row${selected ? " link-row--selected" : ""}`}>
      <StatusChip state={link.state} />
      <div className="link-identity">
        <strong>
          <Link
            to="/links/$linkId"
            params={{ linkId: link.id }}
            search={search}
            aria-label={`Open ${link.title}`}
          >
            /{link.alias}
          </Link>
        </strong>
        <span className="link-route">{link.title}</span>
        <span
          className="link-destination"
          tabIndex={0}
          data-full-value={link.destination.url}
          title={link.destination.url}
        >
          {middleTruncate(link.destination.url)}
        </span>
      </div>
      <time dateTime={link.updatedAt}>{formatDate(link.updatedAt)}</time>
      <Button
        variant="quiet"
        aria-label={`${copied ? "Copied" : "Copy"} short URL for ${link.title}`}
        onClick={() => void copyShortUrl()}
      >
        <Copy aria-hidden="true" size={16} strokeWidth={1.75} />
        {copied ? "Copied" : "Copy"}
      </Button>
      <details className="row-menu">
        <summary aria-label={`More actions for ${link.title}`}>
          <MoreHorizontal aria-hidden="true" size={18} strokeWidth={1.75} />
        </summary>
        <div>
          <Link to="/links/$linkId" params={{ linkId: link.id }} search={search}>
            Open details
          </Link>
          {session.user.role !== "viewer" &&
            rowCommands.map(([command, label]) => (
              <button
                type="button"
                key={command}
                disabled={stateChange.isPending}
                onClick={() => stateChange.mutate(command)}
              >
                {label}
              </button>
            ))}
        </div>
      </details>
    </article>
  );
}
