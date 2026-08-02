import { Archive, CheckCircle2, PauseCircle } from "lucide-react";

import type { LinkState } from "../../types";

export function StatusChip({ state }: Readonly<{ state: LinkState }>) {
  const stateClass = {
    active: "bg-success-soft text-success",
    disabled: "bg-warning-soft text-warning",
    archived: "bg-muted text-muted-foreground",
  }[state];
  return (
    <span
      className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${stateClass}`}
    >
      <StatusIcon state={state} />
      {stateLabel(state)}
    </span>
  );
}

function StatusIcon({ state }: Readonly<{ state: LinkState }>) {
  const Icon = {
    active: CheckCircle2,
    disabled: PauseCircle,
    archived: Archive,
  }[state];
  return <Icon aria-hidden="true" size={14} strokeWidth={1.75} />;
}

export function LinkRowsSkeleton() {
  return (
    <div className="grid gap-2 p-3" aria-label="Loading Links">
      <div className="h-16 animate-pulse rounded-lg bg-muted" />
      <div className="h-16 animate-pulse rounded-lg bg-muted" />
      <div className="h-16 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

export function stateLabel(state: LinkState) {
  return {
    active: "Active",
    disabled: "Disabled",
    archived: "Archived",
  }[state];
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}
