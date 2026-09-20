export const NEWS_CLASSIFICATIONS = [
  "Positive catalyst",
  "Negative",
  "Neutral",
  "Uncertain",
] as const;

export type NewsClassification = (typeof NEWS_CLASSIFICATIONS)[number];

const NEGATIVE = [
  "profit warning",
  "pn17",
  "gn3",
  "lawsuit",
  "litigation",
  "default",
  "impairment",
  "fraud",
  "resign",
  "suspended",
  "query from bursa",
  "going concern",
  "loss after tax",
  "net loss",
];

const POSITIVE = [
  "net profit",
  "profit rises",
  "profit up",
  "dividend",
  "distribution",
  "contract award",
  "awarded",
  "share buyback",
  "buy-back",
  "partnership",
  "completion of",
];

const NEUTRAL = [
  "notice of annual general",
  "notice of agm",
  "change of address",
  "circular to shareholders",
  "monthly production",
  "dealings in listed securities",
];

function haystack(headline: string, excerpt: string | null): string {
  return `${headline}\n${excerpt ?? ""}`.toLowerCase();
}

export function classifyAnnouncement(headline: string, excerpt: string | null): {
  classification: NewsClassification;
  relevanceNote: string;
  matched: string[];
} {
  const text = haystack(headline, excerpt);
  const neg = NEGATIVE.filter((k) => text.includes(k));
  const pos = POSITIVE.filter((k) => text.includes(k));
  const neu = NEUTRAL.filter((k) => text.includes(k));

  if (neg.length && pos.length) {
    return {
      classification: "Uncertain",
      relevanceNote:
        "Keyword rules hit both positive and negative phrases. Headlines are not facts — open the source.",
      matched: [...pos, ...neg],
    };
  }
  if (neg.length) {
    return {
      classification: "Negative",
      relevanceNote: `Rule-based: matched ${neg.join(", ")}. Not a sell signal; read the original filing.`,
      matched: neg,
    };
  }
  if (pos.length) {
    return {
      classification: "Positive catalyst",
      relevanceNote: `Rule-based: matched ${pos.join(", ")}. Not a buy signal; read the original filing.`,
      matched: pos,
    };
  }
  if (neu.length) {
    return {
      classification: "Neutral",
      relevanceNote: `Routine-looking notice (matched ${neu.join(", ")}). Still not a recommendation.`,
      matched: neu,
    };
  }
  return {
    classification: "Uncertain",
    relevanceNote: "No keyword rule matched. Default Uncertain — requires review. Headlines are not facts.",
    matched: [],
  };
}

export function parseClassification(raw: string | undefined): NewsClassification | null {
  if (!raw || !raw.trim()) return null;
  const value = raw.trim();
  return (NEWS_CLASSIFICATIONS as readonly string[]).includes(value)
    ? (value as NewsClassification)
    : null;
}

/** Map stored classifications to 0–1 tone. Missing events stay unavailable (not 0.5). */
export function toneFromClassifications(classifications: NewsClassification[]): number | null {
  if (classifications.length === 0) return null;
  const values = classifications.map((c): number => {
    if (c === "Positive catalyst") return 1;
    if (c === "Negative") return 0;
    return 0.5;
  });
  return values.reduce((a, b) => a + b, 0) / values.length;
}
