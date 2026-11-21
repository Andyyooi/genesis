import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AlertsPage from "@/app/alerts/page";

const mocks = vi.hoisted(() => ({ rows: vi.fn(), status: vi.fn() }));
vi.mock("@/alerts/refresh", () => ({ loadRecentAlerts: mocks.rows }));
vi.mock("@/alerts/publication", () => ({ loadAlertRefreshStatus: mocks.status }));
vi.mock("@/lib/stored-snapshot-dates", () => ({ storedSnapshotDates: () => null }));

beforeEach(() => { mocks.rows.mockReturnValue([]); });

describe("alerts refresh copy", () => {
  it("labels the refresh date and an unchanged comparison honestly", () => {
    mocks.status.mockReturnValue({ asOf: "2026-11-21T12:00:00Z", alerts: { previousRunDate: "2026-11-18", priceDate: "2026-11-20", count: 0 } });
    const html = renderToStaticMarkup(createElement(AlertsPage));
    expect(html).toContain("Alerts from refresh of 2026-11-21");
    expect(html).toContain("No qualifying score, top-pick, exclusion or fair-value safety changes");
    expect(html).toContain("2026-11-18 → this run&#x27;s price date 2026-11-20");
  });

  it("distinguishes a first run from a run that has not regenerated alerts", () => {
    mocks.status.mockReturnValue({ asOf: "2026-11-21", alerts: { previousRunDate: null, count: 0 } });
    expect(renderToStaticMarkup(createElement(AlertsPage))).toContain("No previous published run exists");
    mocks.status.mockReturnValue({ asOf: "2026-11-21", alerts: null });
    expect(renderToStaticMarkup(createElement(AlertsPage))).toContain("old-method alerts are not shown");
    mocks.status.mockReturnValue(null);
    expect(renderToStaticMarkup(createElement(AlertsPage))).toContain("Alerts have not been regenerated");
  });

  it("shows stored alert titles when the latest refresh has changes", () => {
    mocks.status.mockReturnValue({ asOf: "2026-11-21", alerts: { previousRunDate: "2026-11-18", priceDate: "2026-11-20", count: 1 } });
    mocks.rows.mockReturnValue([{ id: 1, ticker: "TEST", name: "Test", ruleId: "top_pick_entered", title: "TEST entered the top picks", why: "Stored comparison", href: "/stock/TEST", triggeredAt: "2026-11-21T12:00:00Z" }]);
    const html = renderToStaticMarkup(createElement(AlertsPage));
    expect(html).toContain("TEST entered the top picks");
    expect(html).not.toContain("No qualifying");
  });
});
