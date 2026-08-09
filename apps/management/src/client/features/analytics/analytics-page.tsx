import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";

import { jsonRequest } from "../../api";
import { instanceAnalyticsResponseSchema } from "../../api-schemas";
import { AnalyticsControls } from "./analytics-controls";
import { analyticsRequestRange, type AnalyticsSearch } from "./analytics-range";
import { AnalyticsResults, AnalyticsSkeleton } from "./analytics-results";

const analyticsApi = getRouteApi("/analytics");

export function AnalyticsPage() {
  const search = analyticsApi.useSearch();
  const navigate = analyticsApi.useNavigate();
  return (
    <div className="grid gap-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Analytics</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Understand how people use this Instance without persistent visitor fingerprinting.
        </p>
      </header>
      <AnalyticsDashboard
        search={search}
        onSearch={(next) => navigate({ search: next })}
        endpoint="/api/internal/analytics"
        showTopLinks
      />
    </div>
  );
}

export function AnalyticsDashboard({
  search,
  onSearch,
  endpoint,
  showTopLinks,
}: Readonly<{
  search: AnalyticsSearch;
  onSearch: (search: AnalyticsSearch) => void | Promise<void>;
  endpoint: string;
  showTopLinks: boolean;
}>) {
  const range = analyticsRequestRange(search);
  const analytics = useQuery({
    queryKey: ["analytics", endpoint, range.start, range.end, range.granularity],
    queryFn: () => {
      const parameters = new URLSearchParams({
        start: range.start,
        end: range.end,
        granularity: range.granularity,
        limit: "10",
      });
      return jsonRequest(endpoint + "?" + parameters.toString(), instanceAnalyticsResponseSchema);
    },
    placeholderData: (previous) => previous,
    refetchOnWindowFocus: "always",
  });

  return (
    <div className="grid gap-6">
      <AnalyticsControls
        search={search}
        onSearch={onSearch}
        onRefresh={() => analytics.refetch()}
      />
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{range.label}</span>
        {analytics.dataUpdatedAt > 0 && (
          <span>
            Last refreshed{" "}
            {new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(
              analytics.dataUpdatedAt,
            )}
          </span>
        )}
      </div>
      {analytics.isPending && <AnalyticsSkeleton />}
      {analytics.isError && !analytics.data && (
        <section className="rounded-xl border bg-card p-6" role="alert">
          <h2 className="font-semibold">Analytics could not be loaded</h2>
          <p className="mt-2 text-sm text-muted-foreground">Try refreshing this view.</p>
        </section>
      )}
      {analytics.isError && analytics.data && (
        <p className="rounded-lg border border-warning bg-warning-soft p-3 text-sm" role="alert">
          Refresh failed. The last successful Analytics result is still shown.
        </p>
      )}
      {analytics.data && (
        <AnalyticsResults
          data={analytics.data}
          metric={search.metric ?? "human"}
          showBots={search.bots === true}
          granularity={range.granularity}
          search={search}
          showTopLinks={showTopLinks}
        />
      )}
    </div>
  );
}
