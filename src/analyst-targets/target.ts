import { parse } from "csv-parse/sync";
import { malaysiaMarketDate } from "@/refresh/types";
import { z } from "zod";

const MAX_IMPORT_ROWS = 200;
const columns = ["ticker", "broker", "target", "date", "source_url"];

export const storedTarget = z.object({
  ticker: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9._-]{0,39}$/, "Enter a Genesis ticker."),
  broker: z.string().trim().min(1, "Enter the broker name.").max(120),
  target: z.number().positive("The target must be above zero.").max(99999999.999),
  date: z.iso.date({ error: "Enter a valid report date (YYYY-MM-DD)." }),
  source_url: z.string().trim().max(2048).regex(/^https?:\/\//i, "Enter an http or https source link.")
    .pipe(z.url({ protocol: /^https?$/, normalize: true, error: "Enter a valid source link." })),
});

const analystTarget = storedTarget.extend({
  target: z.string().trim().regex(/^\d{1,8}(?:\.\d{1,3})?$/, "Enter a target in RM with up to three decimal places.")
    .transform(Number).pipe(storedTarget.shape.target),
});

export type AnalystTarget = z.output<typeof storedTarget>;

export function targetKey(target: AnalystTarget) {
  return JSON.stringify([target.broker.toLowerCase(), target.date]);
}

export function targetAge(date: string, today = malaysiaMarketDate()): string {
  const days = Math.floor((Date.parse(today) - Date.parse(date)) / 86_400_000);
  if (days <= 0) return "Today";
  const [year, month, day] = date.split("-").map(Number);
  const [currentYear, currentMonth, currentDay] = today.split("-").map(Number);
  const lastDayOfMonth = new Date(Date.UTC(currentYear, currentMonth, 0)).getUTCDate();
  const months = (currentYear - year) * 12 + currentMonth - month - Number(currentDay < Math.min(day, lastDayOfMonth));
  if (months < 1) return `${days} day${days === 1 ? "" : "s"} old`;
  return `${months} month${months === 1 ? "" : "s"} old`;
}

export class TargetInputError extends Error {}

function validatedTarget(raw: unknown, today: string, prefix = "") {
  const result = analystTarget.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path.join(".");
    throw new TargetInputError(`${prefix}${field ? `${field}: ` : ""}${issue.message}`);
  }
  if (result.data.date > today) throw new TargetInputError(`${prefix}The report date must not be in the future.`);
  return result.data;
}

export function readTargetInput(body: string, csv: boolean, today = malaysiaMarketDate()) {
  if (!csv) {
    let raw: unknown;
    try { raw = JSON.parse(body); } catch { throw new TargetInputError("Invalid JSON."); }
    return [validatedTarget(raw, today)];
  }
  let rows: string[][];
  try { rows = parse(body, { bom: true, skip_empty_lines: true, trim: true }); }
  catch { throw new TargetInputError("Invalid CSV. Check the commas and quotes in your file."); }
  const header = rows.shift();
  if (header?.length !== columns.length || new Set(header).size !== columns.length || !columns.every((column) => header.includes(column))) {
    throw new TargetInputError(`Use these CSV headers: ${columns.join(", ")}.`);
  }
  if (!rows.length || rows.length > MAX_IMPORT_ROWS) {
    throw new TargetInputError(`Include 1 to ${MAX_IMPORT_ROWS} target rows per file.`);
  }
  return rows.map((row, index) => validatedTarget(
    Object.fromEntries(header.map((column, i) => [column, row[i]])), today, `Data row ${index + 1}: `,
  ));
}
