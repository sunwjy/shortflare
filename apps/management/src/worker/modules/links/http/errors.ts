import type { LinkQueryResult, LinkResult } from "@shortflare/links";
import type { Context } from "hono";

import type { ManagementEnvironment } from "../../../environment";
import { apiError } from "./presenter";

type CommandFailure = Extract<LinkResult, { ok: false }>;

export function commandFailure(context: Context<ManagementEnvironment>, result: CommandFailure) {
  switch (result.kind) {
    case "alias-in-use":
    case "alias-reserved":
      return context.json(apiError(result.kind, { alias: result.alias }), 409);
    case "invalid-alias":
      return context.json(apiError(result.kind, { alias: result.alias }), 400);
    case "invalid-title":
    case "confirmation-mismatch":
      return context.json(apiError(result.kind), 400);
    case "invalid-destination":
      return context.json(apiError(result.kind, { reason: result.reason }), 400);
    case "link-not-found":
      return context.json(apiError(result.kind), 404);
    case "invalid-state":
      return context.json(
        apiError(result.kind, { state: result.state, command: result.command }),
        409,
      );
    case "reserved-alias-not-found":
      return context.json(apiError(result.kind), 404);
    case "alias-generation-exhausted":
      return context.json(apiError(result.kind), 500);
    case "link-conflict":
      return context.json(apiError(result.kind, { revision: result.currentRevision }), 409);
  }
}

type QueryFailure = Extract<LinkQueryResult, { ok: false }>;

export function queryFailure(context: Context<ManagementEnvironment>, result: QueryFailure) {
  switch (result.kind) {
    case "invalid-cursor":
      return context.json(apiError(result.kind), 400);
    case "link-not-found":
      return context.json(apiError(result.kind), 404);
  }
}

export function unexpectedCommand(result: Extract<LinkResult, { ok: true }>): never {
  throw new Error(`Unexpected Link command result: ${result.kind}`);
}

export function unexpectedQuery(result: Extract<LinkQueryResult, { ok: true }>): never {
  throw new Error(`Unexpected Link query result: ${result.kind}`);
}
