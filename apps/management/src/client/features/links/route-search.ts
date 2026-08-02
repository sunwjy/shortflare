import type { LinkState } from "../../types";

export type LinkSearch = Readonly<{
  search?: string;
  state: readonly LinkState[];
}>;

export function linkListPath(search: LinkSearch, cursor?: string) {
  const parameters = new URLSearchParams();
  if (search.search) parameters.set("search", search.search);
  for (const state of search.state) parameters.append("state", state);
  if (cursor) parameters.set("cursor", cursor);
  const query = parameters.toString();
  return `/api/internal/links${query ? `?${query}` : ""}`;
}

export function parseLinkStates(value: unknown): readonly LinkState[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return values.filter(
    (state): state is LinkState =>
      state === "active" || state === "disabled" || state === "archived",
  );
}
