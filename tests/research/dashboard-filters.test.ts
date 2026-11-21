import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DashboardFilters } from "@/components/research/dashboard-filters";

describe("dashboard top-pick options", () => {
  it("preserves options on apply and reset without counting them as dashboard filters", () => {
    const html = renderToStaticMarkup(createElement(DashboardFilters, {
      listId: "quality",
      values: { qualityTilt: "on", lotBudget: "249" },
    }));
    expect(html).toContain('type="hidden" name="qualityTilt" value="on"');
    expect(html).toContain('type="hidden" name="lotBudget" value="249"');
    expect(html).toContain('href="/?qualityTilt=on&amp;lotBudget=249&amp;list=quality"');
    expect(html).not.toContain("1 active");
    expect(html).not.toContain("2 active");
  });

  it("leaves absent options off and retains normal dashboard filter counts", () => {
    const html = renderToStaticMarkup(createElement(DashboardFilters, {
      listId: "watchlist",
      values: { confidence: "HIGH", qualityTilt: undefined, lotBudget: undefined },
    }));
    expect(html).not.toContain('name="qualityTilt"');
    expect(html).not.toContain('name="lotBudget"');
    expect(html).toContain("1 active");
    expect(html).toContain('href="/"');
  });
});
