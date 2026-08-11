import { z } from "zod";

/**
 * The facts Gemini is allowed to report. Extraction only — no score, no
 * status, no recommended action. Those are decided in lib/score.ts.
 *
 * Every field is nullable on purpose: an enquiry that doesn't state a budget
 * must come back as null, not as a plausible-looking guess.
 */
export const ExtractedLeadSchema = z.object({
  customer_name: z.string().nullable(),
  company: z.string().nullable(),
  industry: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  service: z.string().nullable(),

  /** Numeric amount only, no symbols or separators. */
  budget_amount: z.number().nullable(),
  budget_currency: z.enum(["INR", "USD"]).nullable(),

  /** Free text as the sender phrased it, e.g. "this month", "next quarter". */
  timeline: z.string().nullable(),
  urgency: z.enum(["high", "medium", "low"]).nullable(),

  /** Is the ask specific enough to put a quote against? */
  requirement_clarity: z.enum(["clear", "vague", "unclear"]).nullable(),

  /** Can the sender approve spend? Only true when the text actually says so. */
  is_decision_maker: z.boolean().nullable(),

  employee_count: z.number().nullable(),
  intent: z.string().nullable(),
  sentiment: z.enum(["positive", "neutral", "negative"]).nullable(),
});

export type ExtractedLead = z.infer<typeof ExtractedLeadSchema>;

/** An empty extraction — used when Gemini fails and the lead still must be filed. */
export const EMPTY_EXTRACTION: ExtractedLead = {
  customer_name: null,
  company: null,
  industry: null,
  phone: null,
  email: null,
  service: null,
  budget_amount: null,
  budget_currency: null,
  timeline: null,
  urgency: null,
  requirement_clarity: null,
  is_decision_maker: null,
  employee_count: null,
  intent: null,
  sentiment: null,
};

/** Both channels normalize into this before anything else happens. */
export interface Lead {
  /** Stable dedupe key. WhatsApp `wamid`, or `form:<uuid>` for the web form. */
  id: string;
  channel: "whatsapp" | "form";
  /** Sender's WhatsApp number, when we have one. Used to reply. */
  from: string | null;
  /** The raw enquiry text handed to the LLM. */
  message: string;
  receivedAt: string;
}

export type LeadStatus =
  | "Qualified"
  | "Follow-up"
  | "Reject"
  | "Needs Review";

export interface ScoreBreakdown {
  budget: number;
  clear_requirement: number;
  urgent_timeline: number;
  business_email: number;
  decision_maker: number;
}

export interface ScoreResult {
  /** Always equals the sum of `breakdown`. Enforced by test. */
  score: number;
  breakdown: ScoreBreakdown;
  status: LeadStatus;
  next_action: string;
  /** Which criterion cost the most points — drives the follow-up question. */
  biggest_gap: keyof ScoreBreakdown | null;
}
