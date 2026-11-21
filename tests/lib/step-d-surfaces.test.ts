import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { RecentEventsSection } from "@/components/research/recent-events";
import { PersistedFairValue } from "@/components/research/persisted-fair-value";
import type { FairValueRunRead } from "@/fair-value/load-run";
import type { FairValueQualityStatus, FairValueBaseUse } from "@/fair-value/quality";
import type { FairValueResult } from "@/fair-value/types";

vi.mock("@/components/research/estimated-fair-value", () => ({ EstimatedFairValue: () => createElement("p", null, "USABLE_POINT") }));
describe("honest news and persisted safety surfaces", () => {
  it("never displays supplied example / IR event headlines", () => {
    const html = renderToStaticMarkup(createElement(RecentEventsSection, { events: [{ headline: "FAKE_HEADLINE" }] as never }));
    expect(html).toContain("permitted news feed");
    expect(html).not.toContain("FAKE_HEADLINE");
    expect(renderToStaticMarkup(createElement(RecentEventsSection, { events: [] }))).toContain("No news shown");
  });
  it("withholds flagged, absent, no-value and unreadable points while showing persisted reasons", () => {
    const stored = (status: FairValueQualityStatus, baseUse: FairValueBaseUse): FairValueRunRead => ({ ok: true, run: { id: 1, instrumentId: 1, observationKey: "test", qualityVersion: "fair-value-quality-v1", calculatedAt: "2026-09-25", result: {} as FairValueResult, quality: { status, baseUse, methods: [], notes: [{ code: "EPS_PAT_SIGN_CONFLICT", text: "EPS conflicts with PAT" }], historicalLimitation: null } } });
    const flagged = renderToStaticMarkup(createElement(PersistedFairValue, { stored: stored("FLAGGED", "POINT_WITH_CAUTION") }));
    expect(flagged).toContain("FLAGGED");
    expect(flagged).toContain("profit per share (EPS) conflicts with PAT");
    expect(flagged).not.toContain("USABLE_POINT");
    expect(renderToStaticMarkup(createElement(PersistedFairValue, { stored: stored("NO_VALUE", "NO_POINT") }))).not.toContain("USABLE_POINT");
    expect(renderToStaticMarkup(createElement(PersistedFairValue, { stored: null }))).toContain("withheld");
    expect(renderToStaticMarkup(createElement(PersistedFairValue, { stored: { ok: false, id: 1, code: "MALFORMED_JSON", message: "Unreadable" } }))).toContain("Unreadable");
    expect(renderToStaticMarkup(createElement(PersistedFairValue, { stored: stored("CLEAR", "POINT_OK") }))).toContain("USABLE_POINT");
  });
});
