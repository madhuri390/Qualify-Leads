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
  /**
   * Identifiers for the business-research stage. Structured fields, not
   * folded into `message` — the LLM extraction step should never have to
   * parse a URL or handle out of prose, and the research step needs them
   * as data, not text to re-derive.
   */
  website: string | null;
  instagramHandle: string | null;
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

/**
 * What the research stage found, once a Qualified/Follow-up lead has been
 * approved. Each source is independently optional — a lead with no website
 * and a personal (non-Business) Instagram account still gets whatever the
 * others found, rather than the whole stage failing.
 */
export interface GoogleReviewSignal {
  rating: number | null;
  reviewCount: number | null;
  /** One representative recent review, verbatim, for the analysis prompt. */
  snippet: string | null;
}

export interface InstagramSignal {
  /** False when the handle exists but isn't a Business/Creator account — Business Discovery only reads those. */
  available: boolean;
  recentCaptions: string[];
  postCount: number | null;
}

export interface ResearchResult {
  leadId: string;
  generatedAt: string;
  services: string | null;
  painPoints: string | null;
  analysisSummary: string | null;
  googleReviews: GoogleReviewSignal | null;
  instagram: InstagramSignal | null;
  websiteSummary: string | null;
  error?: string;
  /**
   * Whether the WhatsApp booking message actually sent. Written into the
   * same Research row rather than tracked separately, so "call scheduled"
   * survives a page reload instead of only existing in one approve
   * response.
   */
  bookingMessageSent: boolean;
  bookingError?: string;
}
