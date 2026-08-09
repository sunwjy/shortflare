import { isAuditAction, type AuditEventQuery } from "../application/audit-events";

export function parseAuditEventQuery(request: Request): AuditEventQuery | undefined {
  const parameters = new URL(request.url).searchParams;
  const allowed = new Set(["start", "end", "actorId", "action", "subjectId", "limit", "cursor"]);
  if ([...parameters.keys()].some((key) => !allowed.has(key))) return undefined;
  const start = singleDate(parameters, "start");
  const end = singleDate(parameters, "end");
  const actorId = singleOptional(parameters, "actorId");
  const subjectId = singleOptional(parameters, "subjectId");
  const limit = singleLimit(parameters);
  const cursor = singleOptional(parameters, "cursor", 4_096);
  const actions = parameters.getAll("action");
  if (
    start === undefined ||
    end === undefined ||
    actorId === false ||
    subjectId === false ||
    limit === false ||
    cursor === false ||
    actions.some((action) => !isAuditAction(action))
  ) {
    return undefined;
  }
  return {
    start,
    end,
    ...(actorId === undefined ? {} : { actorId }),
    ...(actions.length === 0 ? {} : { actions: actions.filter(isAuditAction) }),
    ...(subjectId === undefined ? {} : { subjectId }),
    ...(limit === undefined ? {} : { limit }),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

function singleDate(parameters: URLSearchParams, name: string) {
  const values = parameters.getAll(name);
  if (values.length !== 1) return undefined;
  const date = new Date(values[0] ?? "");
  return Number.isFinite(date.getTime()) && date.toISOString() === values[0] ? date : undefined;
}

function singleOptional(
  parameters: URLSearchParams,
  name: string,
  maximumLength = 128,
): string | undefined | false {
  const values = parameters.getAll(name);
  if (values.length > 1) return false;
  const value = values[0];
  return value === undefined
    ? undefined
    : value.length > 0 && value.length <= maximumLength
      ? value
      : false;
}

function singleLimit(parameters: URLSearchParams): number | undefined | false {
  const values = parameters.getAll("limit");
  if (values.length > 1) return false;
  if (values.length === 0) return undefined;
  const value = values[0] ?? "";
  if (!/^[1-9]\d*$/.test(value)) return false;
  const limit = Number(value);
  return Number.isSafeInteger(limit) && limit <= 100 ? limit : false;
}
