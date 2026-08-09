import { createFileRoute } from "@tanstack/react-router";

import { AnalyticsPage } from "../features/analytics/analytics-page";
import { normalizeAnalyticsSearch } from "../features/analytics/analytics-range";

export const Route = createFileRoute("/analytics")({
  validateSearch: normalizeAnalyticsSearch,
  component: AnalyticsPage,
});
