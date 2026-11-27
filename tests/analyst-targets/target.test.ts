import { describe, expect, it } from "vitest";
import { readTargetInput, targetAge } from "@/analyst-targets/target";

const today = "2026-11-27";
const row = { ticker: " taann ", broker: "Example, Research", target: "5.125", date: "2026-08-27", source_url: "https://example.com/report" };
const target = { ...row, ticker: "TAANN", target: 5.125 };
const header = "ticker,broker,target,date,source_url";

describe("analyst targets", () => {
  it("accepts equivalent manual input and quoted CSV with a BOM", () => {
    expect(readTargetInput(JSON.stringify(row), false, today)).toEqual([target]);
    const csv = `\uFEFF${header}\r\ntaann,"Example, Research",5.125,2026-08-27,https://example.com/report\r\n`;
    expect(readTargetInput(csv, true, today)).toEqual([target]);
  });

  it.each([
    { target: "0" }, { target: "-1" }, { target: "1.0001" }, { target: "1e2" }, { broker: " " },
    { date: "2026-02-29" }, { date: "2026-11-28" }, { source_url: "javascript:alert(1)" },
    { source_url: "https:example.com" },
  ])("rejects invalid manual fields: %o", (invalid) => {
    expect(() => readTargetInput(JSON.stringify({ ...row, ...invalid }), false, today)).toThrow();
  });

  it("rejects incorrect headers, malformed CSV, too many rows and an invalid later report", () => {
    expect(() => readTargetInput("ticker,broker,target,date,date\n", true, today)).toThrow("Use these CSV headers");
    expect(() => readTargetInput(`${header}\nTAANN,"Missing quote`, true, today)).toThrow("Invalid CSV");
    const valid = "\nTAANN,Broker,4.20,2026-08-27,https://example.com/report";
    expect(() => readTargetInput(header + valid.repeat(201), true, today)).toThrow("1 to 200");
    expect(() => readTargetInput(header + valid + valid.replace("4.20", "0"), true, today)).toThrow("Data row 2");
  });

  it("checks the source link length after percent encoding for manual and CSV input", () => {
    const base = "https://example.com/" + "界".repeat(225);
    const valid = base + "123";
    expect(readTargetInput(JSON.stringify({ ...row, source_url: valid }), false, today)[0].source_url).toHaveLength(2048);
    const tooLong = valid + "5";
    expect(() => readTargetInput(JSON.stringify({ ...row, source_url: tooLong }), false, today)).toThrow("after normalization");
    expect(() => readTargetInput(`${header}\nTAANN,Broker,5,2026-08-27,${tooLong}`, true, today)).toThrow("after normalization");
  });

  it.each([
    [today, "Today"], ["2026-11-26", "1 day old"], ["2026-11-20", "7 days old"],
    ["2026-10-28", "30 days old"], ["2026-10-27", "1 month old"], ["2026-08-27", "3 months old"],
    ["2025-11-27", "12 months old"],
  ])("formats the publication age for %s", (date, label) => {
    expect(targetAge(date, today)).toBe(label);
  });

  it("counts the last day of a shorter month as a month anniversary", () => {
    expect(targetAge("2026-01-31", "2026-02-28")).toBe("1 month old");
  });
});
