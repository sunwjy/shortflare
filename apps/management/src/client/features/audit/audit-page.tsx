import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useState } from "react";

import { jsonRequest } from "../../api";
import { auditEventsPageResponseSchema } from "../../api-schemas";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select";
import { auditActions } from "../../../shared/audit";

const rootApi = getRouteApi("__root__");

type Filters = Readonly<{
  start: string;
  end: string;
  action: string;
  actorId: string;
  subjectId: string;
}>;

export function AuditPage() {
  const { session } = rootApi.useRouteContext();
  if (session.user.role !== "administrator") {
    return (
      <section className="mx-auto my-8 rounded-lg border bg-card p-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Not available</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Audit Event browsing is restricted to Administrators.
        </p>
      </section>
    );
  }
  return <AdministratorAuditPage />;
}

function AdministratorAuditPage() {
  const initial = defaultFilters();
  const [draft, setDraft] = useState<Filters>(initial);
  const [filters, setFilters] = useState<Filters>(initial);
  const [cursor, setCursor] = useState<string>();
  const [rangeError, setRangeError] = useState("");
  const events = useQuery({
    queryKey: ["audit-events", filters, cursor],
    queryFn: () => jsonRequest(auditUrl(filters, cursor), auditEventsPageResponseSchema),
  });

  function applyFilters() {
    if (!validRange(draft)) {
      setRangeError("Choose a range from 1 through 366 UTC days.");
      return;
    }
    setRangeError("");
    setCursor(undefined);
    setFilters(draft);
  }

  return (
    <div className="grid gap-7">
      <header>
        <h1 className="text-[1.75rem] leading-[2.125rem] font-[650] tracking-tight">
          Audit Events
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Review retained administrative changes and security-sensitive operations.
        </p>
      </header>
      <section className="rounded-xl border bg-card p-4" aria-label="Audit Event filters">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <FilterField label="Start date">
            <Input
              type="date"
              value={draft.start}
              onChange={(event) => setDraft({ ...draft, start: event.target.value })}
            />
          </FilterField>
          <FilterField label="End date">
            <Input
              type="date"
              value={draft.end}
              onChange={(event) => setDraft({ ...draft, end: event.target.value })}
            />
          </FilterField>
          <FilterField label="Action">
            <NativeSelect
              className="w-full"
              value={draft.action}
              onChange={(event) => setDraft({ ...draft, action: event.target.value })}
            >
              <NativeSelectOption value="">All actions</NativeSelectOption>
              {auditActions.map((action) => (
                <NativeSelectOption key={action} value={action}>
                  {actionLabel(action)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </FilterField>
          <FilterField label="Actor ID">
            <Input
              value={draft.actorId}
              onChange={(event) => setDraft({ ...draft, actorId: event.target.value })}
            />
          </FilterField>
          <FilterField label="Subject ID">
            <Input
              value={draft.subjectId}
              onChange={(event) => setDraft({ ...draft, subjectId: event.target.value })}
            />
          </FilterField>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={applyFilters}>Apply filters</Button>
          <span className="text-xs text-muted-foreground">
            Dates use UTC. End date is inclusive.
          </span>
          {rangeError && (
            <span className="text-sm text-destructive" role="alert">
              {rangeError}
            </span>
          )}
        </div>
      </section>
      {events.isPending && (
        <div className="h-48 animate-pulse rounded-xl bg-muted" aria-label="Loading Audit Events" />
      )}
      {events.isError && (
        <section className="rounded-xl border bg-card p-6" role="alert">
          <h2 className="font-semibold">Audit Events could not be loaded</h2>
          <p className="mt-2 text-sm text-muted-foreground">Check the filters and try again.</p>
        </section>
      )}
      {events.data && <AuditEventCollection events={events.data.items} />}
      {events.data?.nextCursor && (
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => setCursor(events.data.nextCursor ?? undefined)}>
            Next page
          </Button>
        </div>
      )}
    </div>
  );
}

function FilterField({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      <span>{label}</span>
      {children}
    </label>
  );
}

type AuditEvent = (typeof auditEventsPageResponseSchema)["_output"]["items"][number];

function AuditEventCollection({ events }: Readonly<{ events: readonly AuditEvent[] }>) {
  if (events.length === 0)
    return (
      <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        No Audit Events match these filters.
      </p>
    );
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table
        className="w-full min-w-4xl border-collapse text-left text-sm"
        aria-label="Audit Event collection"
      >
        <thead className="bg-muted/60 text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Time</th>
            <th className="px-4 py-3 font-medium">Action</th>
            <th className="px-4 py-3 font-medium">Actor</th>
            <th className="px-4 py-3 font-medium">Subject</th>
            <th className="px-4 py-3 font-medium">Context</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr className="border-t align-top" key={event.id}>
              <td className="px-4 py-3 whitespace-nowrap tabular-nums">
                {new Intl.DateTimeFormat(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(event.occurredAt))}
              </td>
              <td className="px-4 py-3 font-medium">{actionLabel(event.action)}</td>
              <td className="px-4 py-3">
                <Identifier value={event.actor} />
              </td>
              <td className="px-4 py-3">
                <Identifier value={event.subject} />
              </td>
              <td className="px-4 py-3 text-muted-foreground">{metadataLabel(event.metadata)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Identifier({ value }: Readonly<{ value: { id: string; display: string | null } }>) {
  return (
    <span className="grid gap-1">
      <span>{value.display ?? value.id}</span>
      {value.display && <code className="text-xs text-muted-foreground">{value.id}</code>}
    </span>
  );
}

function auditUrl(filters: Filters, cursor?: string) {
  const parameters = new URLSearchParams({
    start: `${filters.start}T00:00:00.000Z`,
    end: `${nextUtcDate(filters.end)}T00:00:00.000Z`,
    limit: "50",
  });
  if (filters.action) parameters.append("action", filters.action);
  if (filters.actorId.trim()) parameters.set("actorId", filters.actorId.trim());
  if (filters.subjectId.trim()) parameters.set("subjectId", filters.subjectId.trim());
  if (cursor) parameters.set("cursor", cursor);
  return `/api/internal/audit-events?${parameters}`;
}

function defaultFilters(): Filters {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);
  return { start: utcDate(start), end: utcDate(end), action: "", actorId: "", subjectId: "" };
}

function validRange(filters: Filters) {
  const start = Date.parse(`${filters.start}T00:00:00.000Z`);
  const end = Date.parse(`${filters.end}T00:00:00.000Z`);
  const days = (end - start) / 86_400_000 + 1;
  return Number.isInteger(days) && days >= 1 && days <= 366;
}

function nextUtcDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return utcDate(date);
}

function utcDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function actionLabel(action: string) {
  return action
    .split("-")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ")
    .replace("Role Change", "Role Changed");
}

function metadataLabel(metadata: AuditEvent["metadata"]) {
  if (metadata.fromRole && metadata.toRole) return `${metadata.fromRole} → ${metadata.toRole}`;
  if (metadata.fromState && metadata.toState) return `${metadata.fromState} → ${metadata.toState}`;
  if (metadata.fromUserState && metadata.toUserState)
    return `${metadata.fromUserState} → ${metadata.toUserState}`;
  if (metadata.changedFields) return metadata.changedFields.join(", ");
  return metadata.alias ?? metadata.analyticsDate ?? metadata.destinationVersionId ?? "—";
}
