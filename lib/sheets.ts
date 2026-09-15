import { JWT } from "google-auth-library";
import { requireEnv, requirePrivateKey } from "./env";
import { formatBreakdown } from "./score";
import type {
  ExtractedLead,
  GoogleReviewSignal,
  Lead,
  ResearchResult,
  ScoreResult,
} from "./types";

/**
 * Append-only access to the Google Sheet.
 *
 * No cell updates, no read-modify-write. Every event appends a row, which
 * sidesteps the Sheets API's total lack of transactions and leaves a full
 * audit trail of what the agent saw and decided.
 *
 * Five tabs, each append-only in the same way: Leads (the original
 * extraction + score), Approvals (a log of "run research on this lead"),
 * Research (what the research stage found), Rejections (a log of "not
 * pursuing this lead"), and Outcomes (a log of "here's where this lead's
 * conversation got to" — Interested / Call Scheduled). All four logs are
 * kept separate rather than editing the Leads row, so the append-only rule
 * never bends. A lead's current state — approved? rejected? which funnel
 * stage? — is the join of all five by Lead ID, computed by whoever reads
 * them (the dashboard) rather than stored anywhere as a mutable flag. For
 * Outcomes specifically, "current" means the *last* row for that Lead ID —
 * sales can move a lead from Interested to Call Scheduled by appending a
 * newer row, never by editing the old one.
 *
 * Uses the REST API over a JWT rather than the `googleapis` package — that
 * package installs ~100MB and would crowd Vercel's bundle limit.
 */

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

/** Column order is the contract between this file and the Leads tab. */
export const COLUMNS = [
  "Received At",
  "Channel",
  "Message ID",
  "Name",
  "Company",
  "Phone",
  "Email",
  "Service",
  "Budget",
  "Currency",
  "Timeline",
  "Urgency",
  "Clarity",
  "Decision Maker",
  "Score",
  "Breakdown",
  "Status",
  "Next Action",
  "Raw Message",
  "Error",
  // Appended at the end, not interleaved — the Sheet already had 20 columns
  // of live data before these existed, and inserting them earlier would
  // shift every column reference in a Sheet someone is already looking at.
  "Website",
  "Instagram",
] as const;

/** A second, append-only tab: one row per "run research" approval. */
export const APPROVAL_COLUMNS = ["Lead ID", "Approved At"] as const;

/** A third append-only tab: one row per completed research run. */
export const RESEARCH_COLUMNS = [
  "Lead ID",
  "Generated At",
  "Services",
  "Pain Points",
  "Analysis Summary",
  "Google Rating",
  "Google Review Count",
  "Google Review Snippet",
  "Instagram Available",
  "Instagram Recent Captions",
  "Website Summary",
  "Error",
  "Booking Message Sent",
  "Booking Error",
] as const;

/** A fourth append-only tab: one row per "not pursuing this lead" decision. */
export const REJECTION_COLUMNS = ["Lead ID", "Rejected At"] as const;

/** A fifth append-only tab: one row per funnel-stage update sales makes by hand. */
export const OUTCOME_COLUMNS = ["Lead ID", "Outcome", "Set At"] as const;
export type Outcome = "Interested" | "Call Scheduled";

const LEADS_TAB = () => process.env.GOOGLE_SHEET_TAB?.trim() || "Leads";
const APPROVALS_TAB = () => process.env.GOOGLE_APPROVALS_TAB?.trim() || "Approvals";
const RESEARCH_TAB = () => process.env.GOOGLE_RESEARCH_TAB?.trim() || "Research";
const REJECTIONS_TAB = () => process.env.GOOGLE_REJECTIONS_TAB?.trim() || "Rejections";
const OUTCOMES_TAB = () => process.env.GOOGLE_OUTCOMES_TAB?.trim() || "Outcomes";

let cachedClient: JWT | null = null;

function getAuth(): JWT {
  cachedClient ??= new JWT({
    email: requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    key: requirePrivateKey("GOOGLE_PRIVATE_KEY"),
    scopes: SCOPES,
  });
  return cachedClient;
}

/** A1 ranges need the tab name single-quoted once it contains spaces. */
function range(a1: string, tabName: string): string {
  return encodeURIComponent(`'${tabName.replace(/'/g, "''")}'!${a1}`);
}

async function sheetsFetch(
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const { token } = await getAuth().getAccessToken();
  if (!token) throw new Error("Failed to obtain a Google access token");

  const response = await fetch(`${SHEETS_API}/${requireEnv("GOOGLE_SHEET_ID")}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    const hint =
      response.status === 403
        ? ` — share the Sheet with ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL} as Editor`
        : "";
    throw new Error(`Sheets API ${response.status}: ${body}${hint}`);
  }
  return response.json();
}

/** Writes the Leads tab header row. Run once via `npm run sheet:init`. */
export async function writeHeaderRow(): Promise<void> {
  await sheetsFetch(
    `/values/${range("A1", LEADS_TAB())}?valueInputOption=RAW`,
    { method: "PUT", body: JSON.stringify({ values: [COLUMNS] }) },
  );
}

/**
 * Writes the Approvals, Research, Rejections, and Outcomes tab header rows.
 * The tabs themselves must already exist in the Sheet (Sheets API can't
 * create one) — add them by hand first, same as the Leads tab was, then run
 * `npm run sheet:init`.
 */
export async function writeSecondaryHeaderRows(): Promise<void> {
  await sheetsFetch(
    `/values/${range("A1", APPROVALS_TAB())}?valueInputOption=RAW`,
    { method: "PUT", body: JSON.stringify({ values: [APPROVAL_COLUMNS] }) },
  );
  await sheetsFetch(
    `/values/${range("A1", RESEARCH_TAB())}?valueInputOption=RAW`,
    { method: "PUT", body: JSON.stringify({ values: [RESEARCH_COLUMNS] }) },
  );
  await sheetsFetch(
    `/values/${range("A1", REJECTIONS_TAB())}?valueInputOption=RAW`,
    { method: "PUT", body: JSON.stringify({ values: [REJECTION_COLUMNS] }) },
  );
  await sheetsFetch(
    `/values/${range("A1", OUTCOMES_TAB())}?valueInputOption=RAW`,
    { method: "PUT", body: JSON.stringify({ values: [OUTCOME_COLUMNS] }) },
  );
}

/**
 * Dedupe check. Meta retries webhooks, and an append is not idempotent —
 * without this a retry puts a duplicate row on screen mid-demo.
 *
 * Reads the Message ID column rather than caching in memory, because Vercel
 * functions are stateless and any in-process cache would be a lie.
 */
export async function hasSeenMessage(messageId: string): Promise<boolean> {
  const data = (await sheetsFetch(`/values/${range("C2:C", LEADS_TAB())}`)) as {
    values?: string[][];
  };
  return (data.values ?? []).some((row) => row[0] === messageId);
}

/**
 * Wipes every data row, leaving the header. A maintenance operation for
 * resetting between demo takes — the pipeline never calls it, and nothing here
 * loosens the append-only rule the agent itself follows.
 */
export async function clearDataRows(): Promise<void> {
  await sheetsFetch(`/values/${range("A2:V", LEADS_TAB())}:clear`, { method: "POST" });
  await sheetsFetch(`/values/${range("A2:B", APPROVALS_TAB())}:clear`, { method: "POST" });
  await sheetsFetch(`/values/${range("A2:N", RESEARCH_TAB())}:clear`, { method: "POST" });
  await sheetsFetch(`/values/${range("A2:B", REJECTIONS_TAB())}:clear`, { method: "POST" });
  await sheetsFetch(`/values/${range("A2:C", OUTCOMES_TAB())}:clear`, { method: "POST" });
}

export interface LeadRow {
  lead: Lead;
  extracted: ExtractedLead;
  result: ScoreResult;
  error?: string;
}

export async function appendLeadRow({
  lead,
  extracted,
  result,
  error,
}: LeadRow): Promise<void> {
  const row = [
    lead.receivedAt,
    lead.channel,
    lead.id,
    extracted.customer_name ?? "",
    extracted.company ?? "",
    extracted.phone ?? lead.from ?? "",
    extracted.email ?? "",
    extracted.service ?? "",
    extracted.budget_amount ?? "",
    extracted.budget_currency ?? "",
    extracted.timeline ?? "",
    extracted.urgency ?? "",
    extracted.requirement_clarity ?? "",
    extracted.is_decision_maker === null ? "" : String(extracted.is_decision_maker),
    result.score,
    formatBreakdown(result),
    result.status,
    result.next_action,
    lead.message,
    error ?? "",
    lead.website ?? "",
    lead.instagramHandle ?? "",
  ];

  await sheetsFetch(
    `/values/${range("A1", LEADS_TAB())}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: [row] }) },
  );
}

/** One row as the dashboard needs it: the Leads columns, by name, plus the id. */
export interface LeadRecord {
  id: string;
  receivedAt: string;
  channel: string;
  customerName: string;
  company: string;
  phone: string;
  email: string;
  service: string;
  budgetAmount: string;
  budgetCurrency: string;
  timeline: string;
  score: number;
  status: string;
  nextAction: string;
  message: string;
  website: string | null;
  instagram: string | null;
}

/** Every lead row in the Sheet, oldest first — same order the Sheet shows them in. */
export async function readLeadRows(): Promise<LeadRecord[]> {
  const data = (await sheetsFetch(`/values/${range("A2:V", LEADS_TAB())}`)) as {
    values?: string[][];
  };
  return (data.values ?? []).map((row) => ({
    receivedAt: row[0] ?? "",
    channel: row[1] ?? "",
    id: row[2] ?? "",
    customerName: row[3] ?? "",
    company: row[4] ?? "",
    phone: row[5] ?? "",
    email: row[6] ?? "",
    service: row[7] ?? "",
    budgetAmount: row[8] ?? "",
    budgetCurrency: row[9] ?? "",
    timeline: row[10] ?? "",
    score: Number(row[14] ?? 0),
    status: row[16] ?? "",
    nextAction: row[17] ?? "",
    message: row[18] ?? "",
    website: row[20] || null,
    instagram: row[21] || null,
  }));
}

/** Finds one lead's full row by id. Used when an approval fires the research stage. */
export async function findLeadRowById(leadId: string): Promise<LeadRecord | null> {
  const rows = await readLeadRows();
  return rows.find((row) => row.id === leadId) ?? null;
}

/** Appends one "run research" approval. A log entry, not a status flag on the lead row. */
export async function appendApproval(leadId: string): Promise<void> {
  await sheetsFetch(
    `/values/${range("A1", APPROVALS_TAB())}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      body: JSON.stringify({ values: [[leadId, new Date().toISOString()]] }),
    },
  );
}

/** Every lead id that has ever been approved, as a set for a fast membership check. */
export async function listApprovedLeadIds(): Promise<Set<string>> {
  const data = (await sheetsFetch(`/values/${range("A2:A", APPROVALS_TAB())}`)) as {
    values?: string[][];
  };
  return new Set((data.values ?? []).map((row) => row[0]).filter(Boolean));
}

/** Appends one "not pursuing this lead" decision. */
export async function appendRejection(leadId: string): Promise<void> {
  await sheetsFetch(
    `/values/${range("A1", REJECTIONS_TAB())}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      body: JSON.stringify({ values: [[leadId, new Date().toISOString()]] }),
    },
  );
}

/** Every lead id that has ever been rejected. */
export async function listRejectedLeadIds(): Promise<Set<string>> {
  const data = (await sheetsFetch(`/values/${range("A2:A", REJECTIONS_TAB())}`)) as {
    values?: string[][];
  };
  return new Set((data.values ?? []).map((row) => row[0]).filter(Boolean));
}

/**
 * Appends a funnel-stage update. Not a status flag to edit — sales moves a
 * lead from Interested to Call Scheduled by appending a newer row here, same
 * append-only shape as every other tab.
 */
export async function appendOutcome(leadId: string, outcome: Outcome): Promise<void> {
  await sheetsFetch(
    `/values/${range("A1", OUTCOMES_TAB())}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      body: JSON.stringify({ values: [[leadId, outcome, new Date().toISOString()]] }),
    },
  );
}

/** The most recent outcome per lead id — later rows for the same id win. */
export async function readLatestOutcomes(): Promise<Map<string, Outcome>> {
  const data = (await sheetsFetch(`/values/${range("A2:B", OUTCOMES_TAB())}`)) as {
    values?: string[][];
  };
  const latest = new Map<string, Outcome>();
  for (const row of data.values ?? []) {
    if (row[0] && row[1]) latest.set(row[0], row[1] as Outcome);
  }
  return latest;
}

/** Every lead id that already has a completed research row. */
export async function listResearchedLeadIds(): Promise<Set<string>> {
  const data = (await sheetsFetch(`/values/${range("A2:A", RESEARCH_TAB())}`)) as {
    values?: string[][];
  };
  return new Set((data.values ?? []).map((row) => row[0]).filter(Boolean));
}

/** One Research row as the dashboard needs it. */
export interface ResearchRecord {
  leadId: string;
  generatedAt: string;
  services: string;
  painPoints: string;
  analysisSummary: string;
  googleRating: string;
  googleReviewCount: string;
  googleReviewSnippet: string;
  instagramAvailable: string;
  instagramCaptions: string;
  websiteSummary: string;
  error: string;
  bookingMessageSent: string;
  bookingError: string;
}

/** Every completed research row — a lead may appear once, since research only ever runs once per approval. */
export async function readResearchRows(): Promise<ResearchRecord[]> {
  const data = (await sheetsFetch(`/values/${range("A2:N", RESEARCH_TAB())}`)) as {
    values?: string[][];
  };
  return (data.values ?? []).map((row) => ({
    leadId: row[0] ?? "",
    generatedAt: row[1] ?? "",
    services: row[2] ?? "",
    painPoints: row[3] ?? "",
    analysisSummary: row[4] ?? "",
    googleRating: row[5] ?? "",
    googleReviewCount: row[6] ?? "",
    googleReviewSnippet: row[7] ?? "",
    instagramAvailable: row[8] ?? "",
    instagramCaptions: row[9] ?? "",
    websiteSummary: row[10] ?? "",
    error: row[11] ?? "",
    bookingMessageSent: row[12] ?? "",
    bookingError: row[13] ?? "",
  }));
}

export async function appendResearchRow(result: ResearchResult): Promise<void> {
  const row = [
    result.leadId,
    result.generatedAt,
    result.services ?? "",
    result.painPoints ?? "",
    result.analysisSummary ?? "",
    formatRating(result.googleReviews),
    result.googleReviews?.reviewCount ?? "",
    result.googleReviews?.snippet ?? "",
    result.instagram ? String(result.instagram.available) : "",
    result.instagram?.recentCaptions.join(" | ") ?? "",
    result.websiteSummary ?? "",
    result.error ?? "",
    String(result.bookingMessageSent),
    result.bookingError ?? "",
  ];

  await sheetsFetch(
    `/values/${range("A1", RESEARCH_TAB())}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: [row] }) },
  );
}

function formatRating(reviews: GoogleReviewSignal | null): string | number {
  return reviews?.rating ?? "";
}
