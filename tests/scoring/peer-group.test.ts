import { describe, expect, it } from "vitest";
import {
  industryFamilyPrefix,
  isExcludedPeer,
  MIN_USABLE_PEERS,
  selectPeerSet,
  type PeerUniverseRow,
} from "@/scoring/peer-group";
import { metricFromInputs } from "@/scoring/valuation-context";

function row(partial: Partial<PeerUniverseRow> & { ticker: string }): PeerUniverseRow {
  return {
    name: partial.name ?? partial.ticker,
    listingStatus: "listed",
    instrumentType: "COMMON_STOCK",
    researchProfile: "GENERAL",
    industry: "Packaged Foods",
    sector: "Consumer Defensive",
    lastClose: 10,
    lastCloseDate: "2026-09-18",
    periodEnd: "2025-12-31",
    availableAt: null,
    eps: 1,
    dividendPerShare: 0.2,
    equity: 8,
    shares: 1,
    revenue: 20,
    pat: 2,
    ...partial,
  };
}

const voteGeneral = ["price_to_earnings", "dividend_yield", "price_to_book"];

function metricValue(id: string, peer: PeerUniverseRow) {
  return metricFromInputs(id, peer.lastClose, peer).value;
}

describe("peer-group selection", () => {
  it("uses a floor of 5 usable peers at every level", () => {
    expect(MIN_USABLE_PEERS).toBe(5);
  });

  it("takes the industry family prefix before ' - '", () => {
    expect(industryFamilyPrefix("Insurance - Specialty")).toBe("Insurance");
    expect(industryFamilyPrefix("Home Improvement Retail")).toBeNull();
  });

  it("excludes ETFs, warrants, and unlisted names", () => {
    expect(isExcludedPeer(row({ ticker: "ABFMY1", name: "ABF Malaysia Bond Index Fund" }))).toBe(true);
    expect(isExcludedPeer(row({ ticker: "1234WA", name: "Foo Call Warrant" }))).toBe(true);
    expect(isExcludedPeer(row({ ticker: "GONE", listingStatus: "delisted" }))).toBe(true);
    expect(isExcludedPeer(row({ ticker: "NESTLE", name: "Nestle (Malaysia) Berhad" }))).toBe(false);
  });

  it("BANK uses the whole BANK profile and never industrials", () => {
    const peers = [
      ...Array.from({ length: 8 }, (_, i) =>
        row({ ticker: `B${i}`, researchProfile: "BANK", industry: "Banks - Regional", sector: "Financial Services" }),
      ),
      ...Array.from({ length: 30 }, (_, i) =>
        row({ ticker: `G${i}`, researchProfile: "GENERAL", industry: "Banks - Regional", sector: "Financial Services" }),
      ),
    ];
    const selected = selectPeerSet({
      ticker: "MAYBANK",
      researchProfile: "BANK",
      industry: "Banks - Regional",
      sector: "Financial Services",
      peers,
      voteMetricIds: ["price_to_book", "dividend_yield", "price_to_earnings"],
      metricValue,
    });
    expect(selected.qualityBase.groupType).toBe("BANK_PROFILE");
    expect(selected.rows.every((r) => r.researchProfile === "BANK")).toBe(true);
    expect(selected.rows.some((r) => r.ticker.startsWith("G"))).toBe(false);
    expect(selected.qualityBase.eligibleCount).toBe(8);
  });

  it("REIT uses the whole REIT profile even with empty industry", () => {
    const peers = [
      ...Array.from({ length: 6 }, (_, i) =>
        row({
          ticker: `R${i}`,
          researchProfile: "REIT",
          instrumentType: "REIT",
          industry: i % 2 ? "REIT - Retail" : null,
          sector: "Real Estate",
        }),
      ),
      ...Array.from({ length: 20 }, (_, i) =>
        row({ ticker: `DEV${i}`, researchProfile: "GENERAL", industry: "Real Estate - Development", sector: "Real Estate" }),
      ),
    ];
    const selected = selectPeerSet({
      ticker: "KLCC",
      researchProfile: "REIT",
      industry: null,
      sector: "Real Estate",
      peers,
      voteMetricIds: ["dividend_yield", "book_nav_premium"],
      metricValue,
    });
    expect(selected.qualityBase.groupType).toBe("REIT_PROFILE");
    expect(selected.rows).toHaveLength(6);
    expect(selected.rows.every((r) => r.researchProfile === "REIT")).toBe(true);
  });

  it("GENERAL prefers exact industry when n>=5", () => {
    const peers = [
      ...Array.from({ length: 6 }, (_, i) =>
        row({ ticker: `SEMI${i}`, industry: "Semiconductor Equipment & Materials", sector: "Technology" }),
      ),
      ...Array.from({ length: 20 }, (_, i) => row({ ticker: `TECH${i}`, industry: "Software", sector: "Technology" })),
    ];
    const selected = selectPeerSet({
      ticker: "INARI",
      researchProfile: "GENERAL",
      industry: "Semiconductor Equipment & Materials",
      sector: "Technology",
      peers,
      voteMetricIds: voteGeneral,
      metricValue,
    });
    expect(selected.qualityBase.groupType).toBe("INDUSTRY");
    expect(selected.qualityBase.eligibleCount).toBe(6);
  });

  it("falls back to industry family when the leaf is too small", () => {
    const peers = [
      row({ ticker: "A", industry: "Insurance - Specialty", sector: "Financial Services" }),
      row({ ticker: "B", industry: "Insurance - Specialty", sector: "Financial Services" }),
      ...Array.from({ length: 6 }, (_, i) =>
        row({ ticker: `LIFE${i}`, industry: "Insurance - Life", sector: "Financial Services" }),
      ),
    ];
    const selected = selectPeerSet({
      ticker: "TAKAFUL",
      researchProfile: "GENERAL",
      industry: "Insurance - Specialty",
      sector: "Financial Services",
      peers,
      voteMetricIds: voteGeneral,
      metricValue,
    });
    expect(selected.qualityBase.groupType).toBe("INDUSTRY_FAMILY");
    expect(selected.qualityBase.eligibleCount).toBe(8);
  });

  it("falls back to sector only when industry and family are too small (MRDIY-like)", () => {
    const peers = [
      ...Array.from({ length: 6 }, (_, i) =>
        row({
          ticker: `CYC${i}`,
          industry: "Specialty Retail",
          sector: "Consumer Cyclical",
        }),
      ),
      ...Array.from({ length: 40 }, (_, i) =>
        row({ ticker: `FOOD${i}`, industry: "Packaged Foods", sector: "Consumer Defensive" }),
      ),
    ];
    const selected = selectPeerSet({
      ticker: "MRDIY",
      researchProfile: "GENERAL",
      industry: "Home Improvement Retail",
      sector: "Consumer Cyclical",
      peers,
      voteMetricIds: voteGeneral,
      metricValue,
    });
    expect(selected.qualityBase.groupType).toBe("SECTOR");
    expect(selected.qualityBase.selectionPath).toMatch(/Consumer Cyclical/);
    expect(selected.qualityBase.eligibleCount).toBe(6);
    expect(selected.rows.some((r) => r.ticker.startsWith("FOOD"))).toBe(false);
  });

  it("never uses the whole Bursa when sector/industry are missing or too small", () => {
    const crowd = Array.from({ length: 40 }, (_, i) =>
      row({ ticker: `X${i}`, industry: "Packaged Foods", sector: "Consumer Defensive" }),
    );
    const missing = selectPeerSet({
      ticker: "LONER",
      researchProfile: "GENERAL",
      industry: null,
      sector: null,
      peers: crowd,
      voteMetricIds: voteGeneral,
      metricValue,
    });
    expect(missing.qualityBase.groupType).toBe("NONE");
    expect(missing.qualityBase.unavailableReason).toMatch(/Whole-market median is not used/i);

    const tinySector = selectPeerSet({
      ticker: "TINY",
      researchProfile: "GENERAL",
      industry: "Unique Leaf",
      sector: "Unique Sector",
      peers: [
        row({ ticker: "A", industry: "Unique Leaf", sector: "Unique Sector" }),
        row({ ticker: "B", industry: "Unique Leaf", sector: "Unique Sector" }),
        ...crowd,
      ],
      voteMetricIds: voteGeneral,
      metricValue,
    });
    expect(tinySector.rows).toHaveLength(0);
    expect(tinySector.qualityBase.unavailableReason).toMatch(/Whole Bursa is not used/i);
  });

  it("does not invent a median from 4 usable names", () => {
    const selected = selectPeerSet({
      ticker: "FOOD",
      researchProfile: "GENERAL",
      industry: "Packaged Foods",
      sector: "Consumer Defensive",
      peers: [row({ ticker: "A" }), row({ ticker: "B" }), row({ ticker: "C" }), row({ ticker: "D" })],
      voteMetricIds: voteGeneral,
      metricValue,
    });
    expect(selected.qualityBase.groupType).toBe("NONE");
  });

  it("drops names missing the metric and does not count them as usable", () => {
    const peers = [
      ...Array.from({ length: 4 }, (_, i) => row({ ticker: `OK${i}`, eps: 1 })),
      ...Array.from({ length: 6 }, (_, i) => row({ ticker: `NEG${i}`, eps: -1 })),
    ];
    const selected = selectPeerSet({
      ticker: "FOOD",
      researchProfile: "GENERAL",
      industry: "Packaged Foods",
      sector: "Consumer Defensive",
      peers,
      voteMetricIds: ["price_to_earnings"],
      metricValue,
    });
    expect(selected.qualityBase.groupType).toBe("NONE");
    expect(selected.qualityBase.unavailableReason).toMatch(/best usable metric n=4/);
  });

  it("excludes the subject ticker from eligible counts", () => {
    const peers = Array.from({ length: 5 }, (_, i) => row({ ticker: i === 0 ? "INARI" : `P${i}` }));
    const selected = selectPeerSet({
      ticker: "INARI",
      researchProfile: "GENERAL",
      industry: "Packaged Foods",
      sector: "Consumer Defensive",
      peers,
      voteMetricIds: voteGeneral,
      metricValue,
    });
    expect(selected.qualityBase.eligibleCount).toBe(4);
    expect(selected.qualityBase.groupType).toBe("NONE");
  });
});
