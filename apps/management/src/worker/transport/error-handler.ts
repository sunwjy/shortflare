import type { Context } from "hono";

import type { ManagementEnvironment } from "../environment";

export function handleUnexpectedError(error: Error, context: Context<ManagementEnvironment>) {
  console.error(error);
  return context.json({ ok: false, kind: "internal-error", details: {} } as const, 500);
}
