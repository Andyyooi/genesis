import Link from "next/link";
import { Disclosure } from "./disclosure";

const fields = [
  ["sort", "Sort by", [["ticker", "Ticker"], ["research", "Research score"], ["valuation", "Valuation score"], ["confidence", "Confidence"], ["coverage", "Coverage"], ["freshness", "Freshness"], ["profile", "Profile"], ["sector", "Sector"]]],
  ["confidence", "Data confidence", [["", "Any confidence"], ["HIGH", "High"], ["MEDIUM", "Medium"], ["LOW", "Low"], ["VERY_LOW", "Very low"]]],
  ["freshness", "Accounts freshness", [["", "Any freshness"], ["FRESH", "Fresh"], ["AGING", "Aging"], ["STALE", "Stale"], ["VERY_STALE", "Very stale"], ["UNKNOWN", "Unknown"]]],
  ["profile", "Research profile", [["", "Any profile"], ["GENERAL", "General company"], ["BANK", "Bank"], ["REIT", "REIT"], ["UNKNOWN", "Unclassified"]]],
  ["type", "Investment type", [["", "All types"], ["COMMON_STOCK", "Common stock"], ["REIT", "REIT"]]],
  ["board", "Listing board", [["", "Any board"], ["MAIN", "Main"], ["ACE", "ACE"]]],
  ["cap", "Company size", [["", "Any size"], ["large", "Large"], ["mid", "Mid"], ["small", "Small"]]],
] as const;

export function DashboardFilters({ listId, values }: { listId: string; values: Record<string, string | undefined> }) {
  const topPicksParams = Object.entries(values).filter(([key, value]) => (key === "qualityTilt" || key === "lotBudget") && value) as [string, string][];
  const resetParams = new URLSearchParams(topPicksParams);
  if (listId !== "watchlist") resetParams.set("list", listId);
  const active = Object.entries(values).filter(([key, value]) => !["sort", "qualityTilt", "lotBudget"].includes(key) && value).length;
  return <Disclosure title={`Filters & sort${active ? ` · ${active} active` : ""}`} hint={active ? "Your selected filters are applied. Open to change or clear them." : "Narrow by confidence, freshness, profile and more."} open={active > 0}>
    <form action="/" className="flex flex-col gap-4">
      <input type="hidden" name="list" value={listId} />
      {topPicksParams.map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {fields.map(([name, label, options]) => <label key={name} className="flex flex-col gap-1.5 text-sm font-medium">{label}
          <select name={name} defaultValue={values[name] ?? (name === "sort" ? "ticker" : "")} className="h-10 w-full rounded-lg border bg-background px-3 font-normal">{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select>
        </label>)}
      </div>
      <div className="flex flex-wrap gap-5 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="shariah" value="yes" defaultChecked={values.shariah === "yes"} />Shariah only</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="events" value="yes" defaultChecked={values.events === "yes"} />Has events</label>
      </div>
      <div className="flex items-center gap-4"><button type="submit" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">Apply filters</button><Link href={resetParams.size ? `/?${resetParams}` : "/"} className="text-sm text-primary underline underline-offset-4">Reset</Link></div>
    </form>
  </Disclosure>;
}
