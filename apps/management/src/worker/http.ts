import type { Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { z } from "zod";

import type { ManagementEnvironment } from "./environment";

const sessionCookieName = "__Host-shortflare_session";

export function apiError(kind: string, details: Record<string, unknown> = {}) {
  return { ok: false as const, kind, details };
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
