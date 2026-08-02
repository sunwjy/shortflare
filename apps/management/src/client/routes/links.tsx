import { createFileRoute } from "@tanstack/react-router";

import { LinksPage, parseLinkStates, type LinkSearch } from "../features/links";

export const Route = createFileRoute("/links")({
  validateSearch: (raw): LinkSearch => ({
    ...(typeof raw.search === "string" && raw.search.trim() ? { search: raw.search.trim() } : {}),
    state: parseLinkStates(raw.state),
  }),
  component: LinksPage,
});
