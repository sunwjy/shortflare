import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AnalyticsControls } from "../../src/client/features/analytics/analytics-controls";

describe("Analytics controls", () => {
  it("synchronizes custom date drafts when URL search state changes", () => {
    const onSearch = vi.fn();
    const { rerender } = render(
      <AnalyticsControls
        search={{ range: "custom", start: "2026-08-01", end: "2026-08-03" }}
        onSearch={onSearch}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Start date UTC")).toHaveValue("2026-08-01");
    expect(screen.getByLabelText("End date UTC")).toHaveValue("2026-08-03");

    rerender(
      <AnalyticsControls
        search={{ range: "custom", start: "2026-07-10", end: "2026-07-12" }}
        onSearch={onSearch}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Start date UTC")).toHaveValue("2026-07-10");
    expect(screen.getByLabelText("End date UTC")).toHaveValue("2026-07-12");
  });
});
