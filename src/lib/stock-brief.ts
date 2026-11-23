import type { FairRangeHeadline } from "@/lib/fair-range";
import { formatDateSafe, isFiniteNumber } from "@/lib/display";
import { parseLineItemsJson } from "@/ingest/merge-line-items";
import { latestResultsComparison, SHARP_DROP, type PriceDrop } from "@/lib/price-drop-flag";
import { isMixedIndustry, NO_COMPARABLE_PEERS } from "@/fair-value/comparable-peers";
import { MIN_USABLE_PEERS, type PeerQuality } from "@/scoring/peer-group";

type Period = { periodEnd: string; statementType: string; actualOrEstimate: string; source: string; lineItemsJson: string | null };
type DividendQuote = { annualYieldPercent: number | null; checkedAt: string };

const descriptions: Record<string, { text: string; source: string }> = {
  PBA: {
    text: "Treats and supplies water in Penang.",
    source: "https://www.pbahb.com.my/",
  },
  ESCERAM: {
    text: "Makes ceramic moulds for glove makers and sells building materials, including ready-mix concrete.",
    source: "https://newsfile.futunn.com/public/NN-PersistNoticeAttachment/7781/20260929/910_MYX_3709818_en-us_1.pdf",
  },
};

const compactMyr = new Intl.NumberFormat("en-MY", {
  style: "currency", currency: "MYR", notation: "compact", maximumFractionDigits: 1,
});

function positive(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function nonnegative(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function consecutiveYear(newer: string, older: string): boolean {
  const days = (Date.parse(newer) - Date.parse(older)) / 86_400_000;
  return days >= 330 && days <= 400;
}

function reportedAnnuals(periods: Period[]) {
  const unique = new Map<string, Period>();
  for (const period of periods) {
    if (period.statementType !== "annual" || period.actualOrEstimate !== "actual") continue;
    const existing = unique.get(period.periodEnd);
    if (!existing || (!isFiniteNumber(parseLineItemsJson(existing.lineItemsJson).pat) &&
        isFiniteNumber(parseLineItemsJson(period.lineItemsJson).pat))) {
      unique.set(period.periodEnd, period);
    }
  }
  const annuals = [...unique.values()].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd)).slice(0, 4);
  const gap = annuals.findIndex((row, i) => i > 0 && !consecutiveYear(annuals[i - 1].periodEnd, row.periodEnd));
  return gap === -1 ? annuals : annuals.slice(0, gap);
}

function describePeerComparison(profile: string, industry: string, peers?: PeerQuality | null): string {
  const expectedGroup = profile === "BANK" ? "BANK_PROFILE" : profile === "REIT" ? "REIT_PROFILE" : "INDUSTRY";
  if (!peers || peers.groupType !== expectedGroup) return NO_COMPARABLE_PEERS;
  if (expectedGroup === "INDUSTRY" && (!industry || isMixedIndustry(industry) || peers.classificationUsed.industry !== industry)) {
    return "No reliable same-industry comparison is available.";
  }
  const book = peers.metrics.find(metric => metric.metricId === "price_to_book");
  if (!book || book.usableCount < MIN_USABLE_PEERS || !positive(book.subject) || !positive(book.median)) {
    return "Not enough usable net asset figures for a comparison.";
  }
  const group = profile === "BANK" ? "banks" : profile === "REIT" ? "REITs" : "same-industry companies";
  return `In the saved comparison, the price was ${book.subject.toFixed(1)}× net assets per share, versus ${book.median.toFixed(1)}× for the middle of ${book.usableCount} other ${group}.`;
}

export function buildStockBrief(args: {
  ticker: string;
  industry: string | null;
  sector: string | null;
  profile: string;
  periods: Period[];
  close: number | null;
  fairRange: FairRangeHeadline;
  peers?: PeerQuality | null;
  priceDrop: PriceDrop | null;
  dividendQuote?: DividendQuote;
  pn17: boolean;
  warningFlag: boolean;
  needsVerification: boolean;
}) {
  const annuals = reportedAnnuals(args.periods);
  const [latest, previous, ...older] = annuals.map(row => parseLineItemsJson(row.lineItemsJson));
  const positives: string[] = [];
  const risks: string[] = [];
  const watch: string[] = [];
  const latestResults = latestResultsComparison(annuals, { includeSales: args.profile !== "BANK" });
  const hasLoss = isFiniteNumber(latest?.pat) && latest.pat < 0;
  const corporate = args.profile === "GENERAL";
  const latestDebt = latest?.totalDebt;
  const priorDebt = previous?.totalDebt;
  const debtRose = corporate && isFiniteNumber(latestDebt) && positive(priorDebt) && latestDebt >= priorDebt * 1.2;

  if (args.pn17 || args.warningFlag) {
    risks.push(args.pn17 ? "Bursa has flagged this company for financial distress (PN17)." : "This company has a listing warning.");
    watch.push("Check the latest exchange notice and what the company is doing about it.");
  }
  if (hasLoss || latestResults?.tone === "weaker") {
    risks.push(latestResults?.text ?? "The latest full-year accounts show a loss.");
  }
  if (!hasLoss && latestResults?.tone === "stronger") positives.push(latestResults.text);
  else if (positive(latest?.pat)) positives.push(`The business reported ${compactMyr.format(latest.pat)} in annual profit.`);

  if (corporate && isFiniteNumber(latest?.ocf) && isFiniteNumber(latest.capex) && latest.capex >= 0) {
    const leftover = latest.ocf - latest.capex;
    if (leftover < 0) {
      risks.push(`Operations and investment spending used ${compactMyr.format(-leftover)} more cash than they brought in.`);
      watch.push("See whether the next results show cash left after investment spending.");
    } else if (leftover > 0) {
      positives.push(`The business had ${compactMyr.format(leftover)} left after investment spending.`);
    }
  }
  if (debtRose) {
    risks.push(`Debt rose ${Math.round(100 * (latestDebt / priorDebt - 1))}% to ${compactMyr.format(latestDebt)} in a year.`);
    watch.push("Check what the extra borrowing funded and whether debt keeps rising.");
  }
  if (corporate && isFiniteNumber(latest?.totalDebt) && latest.totalDebt >= 0 && positive(latest.cash) && latest.cash > latest.totalDebt) {
    positives.push(`Cash (${compactMyr.format(latest.cash)}) exceeded debt (${compactMyr.format(latest.totalDebt)}).`);
  }

  const profits = [latest?.pat, previous?.pat, ...older.map(row => row.pat)];
  if (profits.length >= 3 && profits.every(isFiniteNumber)) {
    const deltas = profits.slice(0, -1).map((value, i) => {
      const before = profits[i + 1];
      const scale = Math.max(Math.abs(value), Math.abs(before));
      return scale > 0 ? (value - before) / scale : 0;
    });
    if (deltas.some(delta => delta <= -0.5) && deltas.some(delta => delta >= 0.5)) {
      risks.push(`Annual profit swung between ${compactMyr.format(Math.min(...profits))} and ${compactMyr.format(Math.max(...profits))} over ${profits.length} years.`);
      watch.push("See whether the latest profit is repeatable or came from one-off gains.");
    }
  }
  const earlierShares = (older.at(-1) ?? previous)?.shares;
  if (positive(latest?.shares) && positive(earlierShares) && latest.shares >= earlierShares * 1.05) {
    const span = annuals.length === 2 ? "a year" : `${annuals.length - 1} years`;
    risks.push(`Reported share count rose ${Math.round(100 * (latest.shares / earlierShares - 1))}% in ${span}.`);
    watch.push("Check whether share issuance, a split, or a reporting change explains the higher share count.");
  }
  const sharpDrop = args.priceDrop && args.priceDrop.drop >= SHARP_DROP - 1e-9 ? args.priceDrop : null;
  if (sharpDrop) {
    watch.unshift("Check recent results and announcements for what drove the price drop.");
  }
  if (args.needsVerification) {
    risks.push("Some key figures are old or missing.");
    watch.push("Verify the latest results before relying on the scores.");
  }

  const eps = args.profile !== "REIT" && positive(latest?.pat) && positive(latest.shares) ? latest.pat / latest.shares : null;
  const assetsPerShare = positive(latest?.equity) && positive(latest.shares) ? latest.equity / latest.shares : null;
  const earningsMultiple = positive(args.close) && positive(eps) ? args.close / eps : null;
  const assetMultiple = positive(args.close) && assetsPerShare ? args.close / assetsPerShare : null;
  const assetGap = positive(assetMultiple) ? Math.round(Math.abs(1 - assetMultiple) * 100) : null;
  const assetComparison = assetGap === null || assetMultiple === null ? null
    : assetGap === 0 ? "about the same as reported net assets per share"
      : `${assetGap}% ${assetMultiple < 1 ? "below" : "above"} reported net assets per share`;
  const comparisons = [
    positive(earningsMultiple) ? `${earningsMultiple.toFixed(1)}× reported annual profit per share` : null,
    assetComparison,
  ].filter(Boolean);
  const pricing = [
    comparisons.length ? `The price is ${comparisons.join(" and ")}.` : null,
    args.fairRange.available ? args.fairRange.positionText : "No reliable fair range is available to judge this price.",
  ].filter(Boolean).join(" ");

  const quotedYield = args.dividendQuote?.annualYieldPercent;
  const dividendName = args.profile === "REIT" ? "Distribution" : "Dividend";
  const reportedYield = annuals[0]?.source !== "yahoo-quote-summary" && nonnegative(latest?.dividendPerShare) && positive(args.close)
    ? latest.dividendPerShare / args.close * 100 : null;
  const dividend = nonnegative(quotedYield) && args.dividendQuote
    ? `${dividendName} yield: ${quotedYield.toFixed(1)}% (provider estimate, ${args.dividendQuote.checkedAt.slice(0, 10)}). Not guaranteed.`
    : nonnegative(reportedYield) ? `${dividendName} yield: ${reportedYield.toFixed(1)}% at the last close, using the saved annual payment. Not guaranteed.`
      : `${dividendName} yield not confirmed in the saved data.`;

  const description = Object.hasOwn(descriptions, args.ticker) ? descriptions[args.ticker] : null;
  const verdict = args.pn17 ? "Financial distress warning"
    : args.warningFlag ? "Listing warning"
      : args.needsVerification ? "Some key figures need checking"
        : positive(latest?.pat) ? debtRose ? "Profitable, but debt rose"
          : sharpDrop ? "Profitable, but the price fell sharply"
            : latestResults?.tone === "weaker" ? "Profitable, but results weakened"
              : "Reported a full-year profit"
          : isFiniteNumber(latest?.pat) ? latest.pat < 0 ? "Reported a full-year loss" : "Broke even in the latest accounts"
            : "Annual profit not confirmed";
  return {
    verdict,
    business: description?.text ?? (args.industry ? `Listed industry: ${args.industry}.` : args.sector ? `Listed sector: ${args.sector}.` : "Business classification unavailable."),
    businessSource: description?.source ?? null,
    periodEnd: annuals[0]?.periodEnd ?? null,
    positives,
    pricing: pricing || "The saved figures do not support a price comparison.",
    peers: describePeerComparison(args.profile, args.industry?.trim() ?? "", args.peers),
    dividend,
    priceDrop: sharpDrop ? `The ${sharpDrop.adjusted ? "split- and dividend-adjusted " : ""}price fell ${Math.round(100 * sharpDrop.drop)}% between its recent high on ${formatDateSafe(sharpDrop.highDate)} and ${formatDateSafe(sharpDrop.lastDate)}. The figures don’t tell us why.` : null,
    risks,
    watch: watch.length ? watch : ["Check the next results and company announcements for changes in the business."],
  };
}
