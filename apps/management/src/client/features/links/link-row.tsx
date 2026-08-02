import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useMatchRoute } from "@tanstack/react-router";
import { Copy, MoreHorizontal } from "lucide-react";
import { useState } from "react";

import { jsonRequest } from "../../api";
import { linkMutationResponseSchema } from "../../api-schemas";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import type { LinkDto } from "../../types";
import { formatDate, StatusChip } from "./link-presentation";

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
  const actionMenuTrigger = (
    <Button variant="ghost" size="icon" aria-label={`More actions for ${link.title}`} />
  );
  const detailsMenuLink = <Link to="/links/$linkId" params={{ linkId: link.id }} search={search} />;

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
    <article
      className={`grid min-h-18 grid-cols-[1fr_auto] items-center gap-3 border-b px-3 py-4 md:grid-cols-[7.5rem_minmax(0,1fr)_auto_auto_auto] ${
        selected ? "bg-accent shadow-[inset_2px_0_var(--primary)]" : ""
      }`}
    >
      <StatusChip state={link.state} />
      <div className="col-span-2 grid min-w-0 gap-0.5 md:col-span-1">
        <strong>
          <Link
            to="/links/$linkId"
            params={{ linkId: link.id }}
            search={search}
            className="text-sm text-foreground underline-offset-4 hover:underline"
            aria-label={`Open ${link.title}`}
          >
            /{link.alias}
          </Link>
        </strong>
        <span className="text-sm text-foreground">{link.title}</span>
        <span
          className="truncate text-xs text-muted-foreground focus:whitespace-normal focus:break-all"
          tabIndex={0}
          title={link.destination.url}
        >
          {link.destination.url}
        </span>
      </div>
      <time className="hidden text-xs text-muted-foreground md:block" dateTime={link.updatedAt}>
        {formatDate(link.updatedAt)}
      </time>
      <Button
        variant="ghost"
        aria-label={`${copied ? "Copied" : "Copy"} short URL for ${link.title}`}
        onClick={() => void copyShortUrl()}
      >
        <Copy aria-hidden="true" size={16} strokeWidth={1.75} />
        {copied ? "Copied" : "Copy"}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger render={actionMenuTrigger}>
          <MoreHorizontal aria-hidden="true" size={18} strokeWidth={1.75} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem render={detailsMenuLink}>Open details</DropdownMenuItem>
          {session.user.role !== "viewer" &&
            rowCommands.map(([command, label]) => (
              <DropdownMenuItem
                key={command}
                disabled={stateChange.isPending}
                onClick={() => stateChange.mutate(command)}
              >
                {label}
              </DropdownMenuItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </article>
  );
}
