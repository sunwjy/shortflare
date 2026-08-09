import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import AnalyticsChart from "../../src/client/features/analytics/analytics-chart";

const series = [
  {
    bucket: "2026-08-09T12:00:00.000Z",
    humanClicks: 3,
    uniqueHumanClicks: 2,
    suspectedBotClicks: 0,
  },
];

describe("Analytics chart", () => {
  it.each([
    ["hour", "Browser time"],
    ["day", "UTC date"],
  ] as const)("labels the %s table time basis", async (granularity, heading) => {
    const user = userEvent.setup();
    render(
      <AnalyticsChart
        title="How did Human Clicks change?"
        series={series}
        metric="human"
        granularity={granularity}
      />,
    );

    await user.click(screen.getByText("View data table"));

    expect(screen.getByRole("columnheader", { name: heading })).toBeVisible();
  });
});
