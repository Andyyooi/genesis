import { describe, expect, it } from "vitest";
import {
  availabilityFlag,
  historicalValuationStatus,
  latestObservationKnownAsOf,
  observationsKnownAsOf,
} from "@/db/point-in-time";
import { matchReportedDateForPeriod, parseYahooEarningsChart } from "@/providers/yahoo-earnings-dates";

describe("point-in-time observations", () => {
  const rows = [
    {
      periodEnd: "2024-12-31",
      availableAt: "2025-02-26",
      retrievedAt: "2026-09-21T00:00:00.000Z",
      source: "yahoo-timeseries",
      statementType: "annual",
    },
    {
      periodEnd: "2023-12-31",
      availableAt: null,
      retrievedAt: "2026-09-21T00:00:00.000Z",
      source: "yahoo-timeseries",
      statementType: "annual",
    },
    {
      periodEnd: "2022-12-31",
      availableAt: "2023-02-27",
      retrievedAt: "2026-09-21T00:00:00.000Z",
      source: "yahoo-timeseries",
      statementType: "annual",
    },
  ];

  it("excludes UNKNOWN available_at and never uses retrieved_at", () => {
    const asOf = "2024-08-01";
    const known = observationsKnownAsOf(rows, asOf);
    expect(known.map((r) => r.periodEnd)).toEqual(["2022-12-31"]);
    expect(known.every((r) => r.availableAt && r.availableAt <= asOf)).toBe(true);
    expect(known.some((r) => r.periodEnd === "2023-12-31")).toBe(false);
    expect(availabilityFlag(null)).toBe("UNKNOWN");
    expect(latestObservationKnownAsOf(rows, "2025-03-01")?.periodEnd).toBe("2024-12-31");
    expect(latestObservationKnownAsOf(rows, "2024-08-01")?.periodEnd).toBe("2022-12-31");
  });

  it("does not treat FY2024 as known before its available_at", () => {
    expect(latestObservationKnownAsOf(rows, "2025-02-25")?.periodEnd).toBe("2022-12-31");
  });

  it("labels historical valuation without claiming PIT when dates are missing", () => {
    expect(historicalValuationStatus({ pointCount: 0, allPointsHaveAvailableAt: false })).toBe("UNAVAILABLE");
    expect(historicalValuationStatus({ pointCount: 3, allPointsHaveAvailableAt: false })).toBe("PERIOD_END_ONLY");
    expect(historicalValuationStatus({ pointCount: 3, allPointsHaveAvailableAt: true })).toBe("POINT_IN_TIME_SAFE");
  });
});

describe("Yahoo reportedDate matching", () => {
  const chart = parseYahooEarningsChart({
    earnings: {
      earningsChart: {
        quarterly: [
          {
            fiscalQuarter: "4Q2025",
            periodEndDate: { fmt: "2025-12-31" },
            reportedDate: { fmt: "2026-02-26" },
          },
          {
            fiscalQuarter: "3Q2025",
            periodEndDate: { fmt: "2025-09-30" },
            reportedDate: { fmt: "2025-11-21" },
          },
        ],
      },
    },
  });

  it("matches an annual only on exact period_end and rejects next-earnings style dates", () => {
    expect(
      matchReportedDateForPeriod({
        periodEnd: "2025-12-31",
        dates: chart,
        ingestDay: "2026-09-21",
      })?.reportedDate,
    ).toBe("2026-02-26");
    expect(
      matchReportedDateForPeriod({
        periodEnd: "2024-12-31",
        dates: chart,
        ingestDay: "2026-09-21",
      }),
    ).toBeNull();
    expect(
      matchReportedDateForPeriod({
        periodEnd: "2025-12-31",
        dates: [{ periodEnd: "2025-12-31", reportedDate: "2025-12-31", fiscalQuarter: "4Q" }],
        ingestDay: "2026-09-21",
      }),
    ).toBeNull();
    expect(
      matchReportedDateForPeriod({
        periodEnd: "2025-12-31",
        dates: [{ periodEnd: "2025-12-31", reportedDate: "2026-11-26", fiscalQuarter: "4Q" }],
        ingestDay: "2026-09-21",
      }),
    ).toBeNull();
  });
});
