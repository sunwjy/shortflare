import { Buffer } from "node:buffer";

import { auditActions, type AuditAction } from "../../../../shared/audit";

export type AuditMetadata = Readonly<{
  alias?: string;
  changedFields?: readonly ("title" | "destination")[];
  fromState?: "active" | "disabled" | "archived";
  toState?: "active" | "disabled" | "archived";
  destinationVersionId?: string;
  fromRole?: "administrator" | "member" | "viewer";
  toRole?: "administrator" | "member" | "viewer";
  fromUserState?: "invited" | "active" | "suspended";
  toUserState?: "invited" | "active" | "suspended";
  analyticsDate?: string;
}>;

export type PersistedAuditEvent = Readonly<{
  id: string;
  actorId: string;
  actorDisplay: string | null;
  action: AuditAction;
  subjectId: string;
  subjectDisplay: string | null;
  occurredAt: Date;
  metadata: AuditMetadata;
}>;

export type AuditEvent = Readonly<{
  id: string;
  actor: Readonly<{ id: string; display: string | null }>;
  action: AuditAction;
  subject: Readonly<{
    id: string;
    kind: "instance" | "link" | "user";
    display: string | null;
  }>;
  occurredAt: Date;
  metadata: AuditMetadata;
}>;

export type AuditEventQuery = Readonly<{
  start: Date;
  end: Date;
  actorId?: string;
  actions?: readonly AuditAction[];
  subjectId?: string;
  limit?: number;
  cursor?: string;
}>;

export type AuditEventPersistence = Readonly<{
  list(query: PersistedAuditEventQuery): Promise<readonly PersistedAuditEvent[]>;
}>;

export type PersistedAuditEventQuery = Omit<AuditEventQuery, "cursor" | "limit"> &
  Readonly<{
    limit: number;
    after?: Readonly<{ occurredAt: Date; id: string }>;
  }>;

const defaultLimit = 50;
const maximumLimit = 100;
const maximumRange = 366 * 24 * 60 * 60 * 1_000;

export function createAuditEvents(persistence: AuditEventPersistence) {
  return {
    async query(query: AuditEventQuery) {
      const validated = validateQuery(query);
      if (!validated) return { ok: false, kind: "invalid-query" } as const;
      const rows = await persistence.list({
        ...validated.filters,
        limit: validated.limit + 1,
        ...(validated.after === undefined ? {} : { after: validated.after }),
      });
      const pageRows = rows.slice(0, validated.limit);
      const last = pageRows.at(-1);
      return {
        ok: true,
        kind: "page",
        items: pageRows.map(toAuditEvent),
        nextCursor:
          rows.length > validated.limit && last !== undefined
            ? encodeCursor(validated.filters, last)
            : null,
      } as const;
    },
  };
}

export type AuditEvents = ReturnType<typeof createAuditEvents>;

export function isAuditAction(value: string): value is AuditAction {
  return (auditActions as readonly string[]).includes(value);
}

function validateQuery(query: AuditEventQuery) {
  const duration = query.end.getTime() - query.start.getTime();
  if (
    !Number.isFinite(query.start.getTime()) ||
    !Number.isFinite(query.end.getTime()) ||
    duration <= 0 ||
    duration > maximumRange ||
    (query.limit !== undefined &&
      (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > maximumLimit))
  ) {
    return undefined;
  }
  const filters = normalizedFilters(query);
  const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor, filters);
  if (query.cursor !== undefined && after === undefined) return undefined;
  return { filters, limit: query.limit ?? defaultLimit, after };
}

function normalizedFilters(query: AuditEventQuery) {
  const actions = query.actions === undefined ? undefined : [...new Set(query.actions)].toSorted();
  return {
    start: query.start,
    end: query.end,
    ...(query.actorId === undefined ? {} : { actorId: query.actorId }),
    ...(actions === undefined || actions.length === 0 ? {} : { actions }),
    ...(query.subjectId === undefined ? {} : { subjectId: query.subjectId }),
  };
}

function toAuditEvent(row: PersistedAuditEvent): AuditEvent {
  return {
    id: row.id,
    actor: {
      id: row.actorId,
      display: row.actorId === "system" ? "Shortflare system" : row.actorDisplay,
    },
    action: row.action,
    subject: {
      id: row.subjectId,
      kind: subjectKind(row.action, row.subjectId),
      display: row.subjectDisplay,
    },
    occurredAt: row.occurredAt,
    metadata: row.metadata,
  };
}

function subjectKind(action: AuditAction, subjectId: string): "instance" | "link" | "user" {
  if (action === "analytics-erase" && subjectId === "instance") return "instance";
  if (
    action === "initial-administrator-activate" ||
    action.startsWith("invitation-") ||
    action === "role-change" ||
    action.startsWith("user-") ||
    action.startsWith("password-") ||
    action === "operator-recovery"
  ) {
    return "user";
  }
  return "link";
}

type CursorFilters = ReturnType<typeof normalizedFilters>;

function encodeCursor(filters: CursorFilters, row: PersistedAuditEvent) {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      filters: serializedFilters(filters),
      occurredAt: row.occurredAt.toISOString(),
      id: row.id,
    }),
  ).toString("base64url");
}

function decodeCursor(value: string, filters: CursorFilters) {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      !isCursor(parsed) ||
      JSON.stringify(parsed.filters) !== JSON.stringify(serializedFilters(filters))
    ) {
      return undefined;
    }
    const occurredAt = new Date(parsed.occurredAt);
    return Number.isFinite(occurredAt.getTime()) ? { occurredAt, id: parsed.id } : undefined;
  } catch {
    return undefined;
  }
}

function serializedFilters(filters: CursorFilters) {
  return {
    start: filters.start.toISOString(),
    end: filters.end.toISOString(),
    ...(filters.actorId === undefined ? {} : { actorId: filters.actorId }),
    ...(filters.actions === undefined ? {} : { actions: filters.actions }),
    ...(filters.subjectId === undefined ? {} : { subjectId: filters.subjectId }),
  };
}

function isCursor(
  value: unknown,
): value is Readonly<{ version: 1; filters: object; occurredAt: string; id: string }> {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    value.version === 1 &&
    "filters" in value &&
    typeof value.filters === "object" &&
    value.filters !== null &&
    "occurredAt" in value &&
    typeof value.occurredAt === "string" &&
    "id" in value &&
    typeof value.id === "string" &&
    value.id.length > 0
  );
}
