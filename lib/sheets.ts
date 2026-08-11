import { JWT } from "google-auth-library";
import { requireEnv, requirePrivateKey } from "./env";
import { formatBreakdown } from "./score";
import type { ExtractedLead, Lead, ScoreResult } from "./types";

/**
 * Append-only access to the Google Sheet.
 *
 * No cell updates, no read-modify-write. Every event appends a row, which
 * sidesteps the Sheets API's total lack of transactions and leaves a full
 * audit trail of what the agent saw and decided.
 *
 * Uses the REST API over a JWT rather than the `googleapis` package — that
 * package installs ~100MB and would crowd Vercel's bundle limit.
 */

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

/** Column order is the contract between this file and the Sheet. */
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
] as const;

let cachedClient: JWT | null = null;

function getAuth(): JWT {
  cachedClient ??= new JWT({
    email: requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    key: requirePrivateKey("GOOGLE_PRIVATE_KEY"),
    scopes: SCOPES,
  });
  return cachedClient;
}

function tab(): string {
  return process.env.GOOGLE_SHEET_TAB?.trim() || "Leads";
}

/** A1 ranges need the tab name single-quoted once it contains spaces. */
function range(a1: string): string {
  return encodeURIComponent(`'${tab().replace(/'/g, "''")}'!${a1}`);
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

/** Writes the header row. Run once via `npm run sheet:init`. */
export async function writeHeaderRow(): Promise<void> {
  await sheetsFetch(
    `/values/${range("A1")}?valueInputOption=RAW`,
    { method: "PUT", body: JSON.stringify({ values: [COLUMNS] }) },
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
  const data = (await sheetsFetch(`/values/${range("C2:C")}`)) as {
    values?: string[][];
  };
  return (data.values ?? []).some((row) => row[0] === messageId);
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
  ];

  await sheetsFetch(
    `/values/${range("A1")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: [row] }) },
  );
}
