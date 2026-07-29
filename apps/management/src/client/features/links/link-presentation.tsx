import { Archive, CheckCircle2, PauseCircle } from "lucide-react";

import type { LinkState } from "../../types";

export function StatusChip({ state }: Readonly<{ state: LinkState }>) {
  return (
    <span className={`status-chip status-chip--${state}`}>
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
    <div className="link-row-skeletons" aria-label="Loading Links">
      <div />
      <div />
      <div />
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

export function middleTruncate(value: string) {
  return value.length > 64 ? `${value.slice(0, 38)}…${value.slice(-22)}` : value;
}
