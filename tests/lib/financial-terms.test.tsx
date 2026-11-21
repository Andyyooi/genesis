import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FinancialTerm } from "@/components/research/financial-term";
import { FINANCIAL_TERMS, financialTerm, plainConcern, plainFinancialText } from "@/lib/financial-terms";

describe("plain financial terms", () => {
  it("keeps recognisable technical terms alongside an explanation", () => {
    for (const [id, term] of Object.entries(FINANCIAL_TERMS)) {
      const html = renderToStaticMarkup(<FinancialTerm id={id} />);
      expect(html).toContain(term.technical);
      expect(term.explanation.length).toBeGreaterThan(30);
    }
    expect(financialTerm("revenue_cagr").explanation).toContain("negative means it shrank");
  });

  it("preserves unknown and empty labels without inventing guidance", () => {
    expect(financialTerm("new_metric", "New metric")).toEqual({ label: "New metric", technical: "New metric", explanation: "" });
    expect(financialTerm("").explanation).toBe("");
    expect(financialTerm("unknown_metric").label).toBe("unknown metric");
  });

  it("explains warning sentences and preserves unknown errors", () => {
    expect(plainConcern("falling_revenue", "CAGR is negative")).toContain("shrank on average each year");
    expect(plainConcern("unknown", "Source unavailable")).toBe("Source unavailable");
    expect(plainConcern("unknown", "")).toBe("");
    expect(plainFinancialText("Revenue CAGR is negative")).toContain("meaning the amount shrank");
    expect(plainFinancialText("Source unavailable")).toBe("Source unavailable");
  });
});
