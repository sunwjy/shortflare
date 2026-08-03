import type { LinkState } from "@shortflare/links";

export function parseLinkListQuery(request: Request):
  | Readonly<{
      search?: string;
      states?: readonly LinkState[];
      limit?: number;
      cursor?: string;
    }>
  | undefined {
  const parameters = new URL(request.url).searchParams;
  const allowed = new Set(["search", "state", "limit", "cursor"]);
  if (Array.from(parameters.keys()).some((key) => !allowed.has(key))) return undefined;

  const searchValues = parameters.getAll("search");
  const limitValues = parameters.getAll("limit");
  const cursorValues = parameters.getAll("cursor");
  if (searchValues.length > 1 || limitValues.length > 1 || cursorValues.length > 1) {
    return undefined;
  }

  const search = searchValues[0]?.trim();
  if (search !== undefined && Array.from(search).length > 200) return undefined;
  const states = parameters.getAll("state");
  if (
    states.some(
      (state): boolean => state !== "active" && state !== "disabled" && state !== "archived",
    )
  ) {
    return undefined;
  }
  const limit = parseLimit(limitValues[0]);
  if (limitValues.length === 1 && limit === undefined) return undefined;
  const cursor = cursorValues[0];
  if (cursorValues.length === 1 && cursor === "") return undefined;

  return {
    ...(search === undefined ? {} : { search }),
    ...(states.length === 0 ? {} : { states: states as LinkState[] }),
    ...(limit === undefined ? {} : { limit }),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

export function parsePageQuery(
  request: Request,
): Readonly<{ limit?: number; cursor?: string }> | undefined {
  const parameters = new URL(request.url).searchParams;
  if (Array.from(parameters.keys()).some((key) => key !== "limit" && key !== "cursor")) {
    return undefined;
  }
  const limitValues = parameters.getAll("limit");
  const cursorValues = parameters.getAll("cursor");
  if (limitValues.length > 1 || cursorValues.length > 1) return undefined;
  const limit = parseLimit(limitValues[0]);
  if (limitValues.length === 1 && limit === undefined) return undefined;
  const cursor = cursorValues[0];
  if (cursorValues.length === 1 && cursor === "") return undefined;
  return {
    ...(limit === undefined ? {} : { limit }),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

export function parseReservedAliasListQuery(
  request: Request,
): Readonly<{ search?: string; limit?: number; cursor?: string }> | undefined {
  const parameters = new URL(request.url).searchParams;
  if (
    Array.from(parameters.keys()).some(
      (key) => key !== "search" && key !== "limit" && key !== "cursor",
    )
  ) {
    return undefined;
  }
  const searchValues = parameters.getAll("search");
  const limitValues = parameters.getAll("limit");
  const cursorValues = parameters.getAll("cursor");
  if (searchValues.length > 1 || limitValues.length > 1 || cursorValues.length > 1) {
    return undefined;
  }
  const search = searchValues[0]?.trim();
  if (search !== undefined && Array.from(search).length > 200) return undefined;
  const limit = parseLimit(limitValues[0]);
  if (limitValues.length === 1 && limit === undefined) return undefined;
  const cursor = cursorValues[0];
  if (cursorValues.length === 1 && cursor === "") return undefined;
  return {
    ...(search === undefined ? {} : { search }),
    ...(limit === undefined ? {} : { limit }),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined || !/^[1-9]\d*$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= 100 ? parsed : undefined;
}
