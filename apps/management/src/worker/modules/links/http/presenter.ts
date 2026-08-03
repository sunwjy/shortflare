import type { Link, LinkSummary } from "@shortflare/links";

export function apiError(kind: string, details: Record<string, unknown> = {}) {
  return { ok: false as const, kind, details };
}

export function toLinkDto(link: Link, redirectDomain: string) {
  const destination = link.destinationVersions.at(-1);
  if (destination === undefined) {
    throw new Error(`Link ${link.id} has no Destination Version`);
  }
  return toLinkTransport(link, destination, redirectDomain);
}

export function toLinkSummaryDto(link: LinkSummary, redirectDomain: string) {
  return toLinkTransport(link, link.currentDestinationVersion, redirectDomain);
}

function toLinkTransport(
  link: Pick<Link, "id" | "alias" | "title" | "state" | "revision" | "createdAt" | "updatedAt">,
  destination: Link["destinationVersions"][number],
  redirectDomain: string,
) {
  return {
    id: link.id,
    alias: link.alias,
    shortUrl: new URL(link.alias, `https://${redirectDomain}/`).href,
    title: link.title,
    state: link.state,
    revision: link.revision,
    destination: {
      id: destination.id,
      versionNumber: destination.versionNumber,
      url: destination.destination,
      createdAt: destination.createdAt.toISOString(),
    },
    createdAt: link.createdAt.toISOString(),
    updatedAt: link.updatedAt.toISOString(),
  };
}

export function toReservedAliasDto(
  alias: Readonly<{ alias: string; deletedLinkId: string; reservedAt: Date }>,
  redirectDomain: string,
) {
  return {
    alias: alias.alias,
    shortUrl: new URL(alias.alias, `https://${redirectDomain}/`).href,
    deletedLinkId: alias.deletedLinkId,
    reservedAt: alias.reservedAt.toISOString(),
  };
}
