import { loadScoringConfig } from "@/config/load-scoring";
import { annualAccounts, usableAccounts } from "@/metrics/evidence";
import { toStatementSnapshots } from "@/metrics/from-snapshots";
import { reportedDividend, selectDividend, type DividendBasis, type DividendCoverage } from "@/lib/dividend-yield";

export function annualDividend(
  periods: Parameters<typeof toStatementSnapshots>[0],
  priceDate: string | null | undefined,
  coverage: DividendCoverage | null,
  asOf = new Date().toISOString(),
): DividendBasis | null {
  return selectDividend(coverage, priceDate, annualAccounts(
    usableAccounts(toStatementSnapshots(periods), asOf, loadScoringConfig().reporting_lag_months).map(reportedDividend),
  ));
}
