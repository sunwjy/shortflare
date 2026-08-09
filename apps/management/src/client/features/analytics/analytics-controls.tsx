import { RefreshCw } from "lucide-react";
import { useState } from "react";

import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import { Input } from "../../components/ui/input";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select";
import {
  analyticsRequestRange,
  normalizeAnalyticsSearch,
  type AnalyticsMetric,
  type AnalyticsRangePreset,
  type AnalyticsSearch,
} from "./analytics-range";

type AnalyticsControlsProps = Readonly<{
  search: AnalyticsSearch;
  onSearch: (search: AnalyticsSearch) => void | Promise<void>;
  onRefresh: () => unknown;
}>;

export function AnalyticsControls(props: AnalyticsControlsProps) {
  const draftKey = `${props.search.start ?? ""}:${props.search.end ?? ""}`;
  return <AnalyticsControlsDraft key={draftKey} {...props} />;
}

function AnalyticsControlsDraft({ search, onSearch, onRefresh }: AnalyticsControlsProps) {
  const requestRange = analyticsRequestRange(search);
  const initialEnd = new Date(new Date(requestRange.end).getTime() - 86_400_000)
    .toISOString()
    .slice(0, 10);
  const [customStart, setCustomStart] = useState(search.start ?? requestRange.start.slice(0, 10));
  const [customEnd, setCustomEnd] = useState(search.end ?? initialEnd);
  const range = search.range ?? "7d";
  const metric = search.metric ?? "human";
  const validCustom = normalizeAnalyticsSearch({
    ...search,
    range: "custom",
    start: customStart,
    end: customEnd,
  });

  function setRange(next: AnalyticsRangePreset) {
    if (next === "custom") {
      void onSearch(
        validCustom.range === "custom"
          ? validCustom
          : { range: "custom", start: customStart, end: customEnd },
      );
      return;
    }
    void onSearch(
      normalizeAnalyticsSearch({
        ...search,
        range: next,
        start: undefined,
        end: undefined,
      }),
    );
  }

  function setMetric(next: AnalyticsMetric) {
    void onSearch(normalizeAnalyticsSearch({ ...search, metric: next }));
  }

  return (
    <section className="grid gap-4 rounded-xl border bg-card p-4" aria-label="Analytics controls">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs text-muted-foreground">
          UTC date range
          <NativeSelect
            value={range}
            onChange={(event) => setRange(event.target.value as AnalyticsRangePreset)}
          >
            <NativeSelectOption value="today">Today</NativeSelectOption>
            <NativeSelectOption value="7d">7 days</NativeSelectOption>
            <NativeSelectOption value="30d">30 days</NativeSelectOption>
            <NativeSelectOption value="90d">90 days</NativeSelectOption>
            <NativeSelectOption value="custom">Custom</NativeSelectOption>
          </NativeSelect>
        </label>
        <div className="flex rounded-lg border p-0.5" aria-label="Analytics metric">
          <Button
            size="sm"
            variant={metric === "human" ? "secondary" : "ghost"}
            aria-pressed={metric === "human"}
            onClick={() => setMetric("human")}
          >
            Human Clicks
          </Button>
          <Button
            size="sm"
            variant={metric === "unique" ? "secondary" : "ghost"}
            aria-pressed={metric === "unique"}
            onClick={() => setMetric("unique")}
          >
            Unique Human Clicks
          </Button>
        </div>
        <label className="flex min-h-8 items-center gap-2 text-sm">
          <Checkbox
            checked={search.bots === true}
            onCheckedChange={(checked) =>
              void onSearch(normalizeAnalyticsSearch({ ...search, bots: checked }))
            }
          />
          Include suspected bots
        </label>
        <Button className="ml-auto" variant="secondary" onClick={onRefresh}>
          <RefreshCw aria-hidden="true" />
          Refresh
        </Button>
      </div>
      {range === "custom" && (
        <div className="flex flex-wrap items-end gap-3 border-t pt-4">
          <label className="grid gap-1 text-xs text-muted-foreground">
            Start date UTC
            <Input
              type="date"
              value={customStart}
              onChange={(event) => setCustomStart(event.target.value)}
            />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            End date UTC
            <Input
              type="date"
              value={customEnd}
              onChange={(event) => setCustomEnd(event.target.value)}
            />
          </label>
          <Button
            variant="secondary"
            disabled={validCustom.range !== "custom"}
            onClick={() => void onSearch(validCustom)}
          >
            Apply dates
          </Button>
          <p className="text-xs text-muted-foreground">
            Maximum 366 UTC dates. Future dates are unavailable.
          </p>
        </div>
      )}
    </section>
  );
}
