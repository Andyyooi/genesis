import { describe, expect, it } from "vitest";
import { classifyAnnouncement, toneFromClassifications } from "@/ingest/classify";
import { parseAnnouncementsCsv } from "@/ingest/providers/csv-announcements";

describe("announcement classification", () => {
  it("labels profit-up headlines as Positive catalyst without BUY language", () => {
    const hit = classifyAnnouncement("Maybank 9M FY24 net profit rises 8.5%", null);
    expect(hit.classification).toBe("Positive catalyst");
    expect(hit.relevanceNote).not.toMatch(/\bBUY\b/);
  });

  it("labels profit warning as Negative even if profit appears", () => {
    expect(classifyAnnouncement("Board issues a profit warning", null).classification).toBe("Negative");
  });

  it("defaults to Uncertain", () => {
    expect(classifyAnnouncement("Company provides an update", null).classification).toBe("Uncertain");
  });

  it("does not invent a 0.5 tone when there are no events", () => {
    expect(toneFromClassifications([])).toBeNull();
  });
});

describe("announcements CSV", () => {
  it("rejects missing ticker, date, or headline", () => {
    const csv = `ticker,occurred_at,available_at,source,source_url,headline,excerpt,classification
,2024-01-01,,src,https://example.com,Headline,,
MAYBANK,, ,src,https://example.com,Headline,,
MAYBANK,2024-01-01,,src,https://example.com,,,
MAYBANK,2024-01-01,,src,https://www.maybank.com/en/news/2024/11/26.page,Net profit up,,
`;
    const parsed = parseAnnouncementsCsv(csv);
    expect(parsed.rejected.map((r) => r.reason).join(" ")).toMatch(/ticker is required/);
    expect(parsed.rejected.map((r) => r.reason).join(" ")).toMatch(/occurred_at is required/);
    expect(parsed.rejected.map((r) => r.reason).join(" ")).toMatch(/headline is required/);
    expect(parsed.accepted).toHaveLength(1);
    expect(parsed.accepted[0]?.classification).toBe("Positive catalyst");
  });
});
