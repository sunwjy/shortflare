import type { Link, LinkState, LinkSummary } from "@shortflare/links";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";

import { type Capability, hasCapability } from "./authorization";
import type { ManagementEnvironment } from "./environment";
import { createIdentity, type User } from "./identity";

const sessionCookieName = "__Host-shortflare_session";

/**
 * Verifies the two request-integrity properties shared by every mutation.
 * Authentication is deliberately separate so public token endpoints can use
 * the same Origin and content-type policy without requiring a Session.
 */
export function isSameOriginJsonRequest(request: Request) {
  return (
    request.headers.get("origin") === new URL(request.url).origin &&
    request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ===
      "application/json"
  );
}

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

export function apiError(kind: string, details: Record<string, unknown> = {}) {
  return { ok: false as const, kind, details };
}

function authenticationError(kind: string, withDetails = false) {
  return withDetails ? apiError(kind) : { ok: false as const, kind };
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

export async function parseJson<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): Promise<z.output<Schema> | undefined> {
  try {
    const result = schema.safeParse(await request.json());
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

export function deleteSessionCookie(context: Parameters<typeof deleteCookie>[0]) {
  deleteCookie(context, sessionCookieName, {
    path: "/",
    secure: true,
  });
}

export function setSessionCookie(
  context: Context<ManagementEnvironment>,
  session: Readonly<{ token: string; expiresAt: Date }>,
) {
  const maxAge = Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1_000));
  setCookie(context, sessionCookieName, session.token, {
    httpOnly: true,
    maxAge,
    path: "/",
    sameSite: "Lax",
    secure: true,
  });
}

export async function authenticateMutation(
  context: Context<ManagementEnvironment>,
  requirements: Readonly<{
    capability?: Capability;
    recent?: boolean;
    apiErrors?: boolean;
  }> = {},
): Promise<
  | Readonly<{
      identity: ReturnType<typeof createIdentity>;
      user: User;
      sessionToken: string;
      recentlyAuthenticated: boolean;
    }>
  | Readonly<{ response: Response }>
> {
  if (!isSameOriginJsonRequest(context.req.raw)) {
    return {
      response: context.json(authenticationError("forbidden", requirements.apiErrors), 403),
    };
  }
  const sessionToken = getCookie(context, sessionCookieName);
  if (!sessionToken) {
    return {
      response: context.json(authenticationError("unauthenticated", requirements.apiErrors), 401),
    };
  }
  const identity = createIdentity({ db: context.env.DB });
  const authentication = await identity.authenticateRequest(
    sessionToken,
    context.req.header("x-csrf-token") ?? "",
    requirements.recent,
  );
  if (!authentication.ok) {
    const unauthenticated = authentication.kind === "invalid-credentials";
    return {
      response: context.json(
        authenticationError(
          unauthenticated ? "unauthenticated" : authentication.kind,
          requirements.apiErrors,
        ),
        unauthenticated ? 401 : 403,
      ),
    };
  }
  if (requirements.capability && !hasCapability(authentication.user, requirements.capability)) {
    return {
      response: context.json(authenticationError("forbidden", requirements.apiErrors), 403),
    };
  }
  return {
    identity,
    user: authentication.user,
    sessionToken,
    recentlyAuthenticated: authentication.recentlyAuthenticated,
  };
}

export async function authenticateSafe(
  context: Context<ManagementEnvironment>,
  capability?: Capability,
  apiErrors = false,
): Promise<
  | Readonly<{ identity: ReturnType<typeof createIdentity>; user: User }>
  | Readonly<{ response: Response }>
> {
  const sessionToken = getCookie(context, sessionCookieName);
  if (!sessionToken) {
    return {
      response: context.json(authenticationError("unauthenticated", apiErrors), 401),
    };
  }
  const identity = createIdentity({ db: context.env.DB });
  const authentication = await identity.authenticate(sessionToken);
  if (!authentication.ok) {
    return {
      response: context.json(authenticationError("unauthenticated", apiErrors), 401),
    };
  }
  if (capability && !hasCapability(authentication.user, capability)) {
    return {
      response: context.json(authenticationError("forbidden", apiErrors), 403),
    };
  }
  return { identity, user: authentication.user };
}
