import type {
  ExtractedLead,
  LeadStatus,
  ScoreBreakdown,
  ScoreResult,
} from "./types";

/**
 * The rubric. Pure function, no I/O, no LLM, no clock, no network.
 *
 * The model is never asked for a score. It reports facts; this file decides
 * what they are worth. That makes every number traceable to a rule, keeps
 * results reproducible across runs, and means a prompt injection telling the
 * model "score this 100" has nothing to attack.
 */

/**
 * Fixed so scores are reproducible. A live FX lookup would mean the same lead
 * scores differently on different days, which breaks the eval.
 */
export const USD_TO_INR = 88;

export const MAX_POINTS: ScoreBreakdown = {
  budget: 30,
  clear_requirement: 20,
  urgent_timeline: 20,
  business_email: 10,
  decision_maker: 20,
};

/** Budget bands in INR. Indian SMB leads, so a flat USD threshold is useless. */
const BUDGET_BANDS: Array<{ min: number; points: number; label: string }> = [
  { min: 1_000_000, points: 30, label: "above ₹10L" },
  { min: 200_000, points: 25, label: "₹2L–₹10L" },
  { min: 50_000, points: 15, label: "₹50k–₹2L" },
  { min: 0, points: 5, label: "under ₹50k" },
];

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "yahoo.co.in",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "rediffmail.com",
  "protonmail.com",
  "aol.com",
]);

/** Converts a stated budget to INR. Returns null when nothing was stated. */
export function toInr(
  amount: number | null,
  currency: "INR" | "USD" | null,
): number | null {
  if (amount === null || !Number.isFinite(amount) || amount < 0) return null;
  // Currency is often omitted for INR amounts in Indian enquiries.
  return currency === "USD" ? amount * USD_TO_INR : amount;
}

export function scoreBudget(lead: ExtractedLead): number {
  const inr = toInr(lead.budget_amount, lead.budget_currency);
  if (inr === null) return 0;
  return BUDGET_BANDS.find((band) => inr >= band.min)?.points ?? 0;
}

export function isBusinessEmail(email: string | null): boolean {
  if (!email) return false;
  const domain = email.trim().toLowerCase().split("@")[1];
  if (!domain || !domain.includes(".")) return false;
  return !FREE_EMAIL_DOMAINS.has(domain);
}

function statusFor(score: number): LeadStatus {
  if (score >= 80) return "Qualified";
  if (score >= 50) return "Follow-up";
  return "Reject";
}

/** The single criterion costing the most points — drives the follow-up question. */
function biggestGap(breakdown: ScoreBreakdown): keyof ScoreBreakdown | null {
  const losses = (Object.keys(MAX_POINTS) as Array<keyof ScoreBreakdown>)
    .map((key) => ({ key, lost: MAX_POINTS[key] - breakdown[key] }))
    .filter((entry) => entry.lost > 0)
    .sort((a, b) => b.lost - a.lost);
  return losses[0]?.key ?? null;
}

const NEXT_ACTIONS: Record<keyof ScoreBreakdown, string> = {
  budget: "Ask for a budget range",
  clear_requirement: "Ask what exactly they want built",
  urgent_timeline: "Ask when they want to start",
  business_email: "Ask for a work email address",
  decision_maker: "Ask who signs off on this",
};

export function scoreLead(lead: ExtractedLead): ScoreResult {
  const breakdown: ScoreBreakdown = {
    budget: scoreBudget(lead),
    clear_requirement:
      lead.requirement_clarity === "clear" ? MAX_POINTS.clear_requirement : 0,
    urgent_timeline: lead.urgency === "high" ? MAX_POINTS.urgent_timeline : 0,
    business_email: isBusinessEmail(lead.email) ? MAX_POINTS.business_email : 0,
    decision_maker:
      lead.is_decision_maker === true ? MAX_POINTS.decision_maker : 0,
  };

  const score = Object.values(breakdown).reduce((sum, n) => sum + n, 0);
  const status = statusFor(score);
  const gap = biggestGap(breakdown);

  const next_action =
    status === "Qualified"
      ? "Schedule discovery call"
      : gap
        ? NEXT_ACTIONS[gap]
        : "Review manually";

  return { score, breakdown, status, next_action, biggest_gap: gap };
}

/** Human-readable audit trail for the Sheet, e.g. "85 = 25+20+20+0+20". */
export function formatBreakdown(result: ScoreResult): string {
  const parts = (Object.keys(MAX_POINTS) as Array<keyof ScoreBreakdown>).map(
    (key) => result.breakdown[key],
  );
  return `${result.score} = ${parts.join("+")}`;
}
