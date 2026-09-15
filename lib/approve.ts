import { sendBookingMessage } from "./notify";
import { research } from "./research";
import {
  appendApproval,
  appendOutcome,
  appendRejection,
  appendResearchRow,
  findLeadRowById,
  listApprovedLeadIds,
  listRejectedLeadIds,
  type LeadRecord,
  type Outcome,
} from "./sheets";
import { EMPTY_EXTRACTION, type ExtractedLead, type Lead, type ResearchResult } from "./types";

/**
 * Everything that happens to a lead after scoring, kept out of pipeline.ts
 * on purpose: that file runs on every inbound message; this only runs when
 * a human acts on one specific lead from the dashboard. Two different
 * triggers, two different failure tolerances — this one is allowed to be
 * slower, and to fail loudly back to the person who clicked the button.
 */

export type ApprovalOutcome = ResearchResult;

/** True once this lead has an Approvals row — the dashboard's "already approved" check. */
export async function isApproved(leadId: string): Promise<boolean> {
  const approved = await listApprovedLeadIds();
  return approved.has(leadId);
}

/**
 * Approves a lead and runs research + the booking message in the same call.
 * The Approvals row goes down first — same reasoning as pipeline.ts writing
 * the Sheet row before notifying: if research then fails, the approval
 * itself is still on record rather than silently lost.
 *
 * The booking-message outcome is folded into the *same* Research row rather
 * than only returned here — the dashboard's "call scheduled" count reads it
 * back from the Sheet on every load, not just from this one response.
 */
export async function approveLead(leadId: string): Promise<ApprovalOutcome> {
  const row = await findLeadRowById(leadId);
  if (!row) throw new Error(`No lead found with id ${leadId}`);

  await appendApproval(leadId);

  const { lead, extracted } = toLeadAndExtracted(row);
  const analysis = await research(lead, extracted.company, extracted.service);

  let bookingMessageSent = false;
  let bookingError: string | undefined;
  try {
    await sendBookingMessage(lead, extracted, analysis);
    bookingMessageSent = true;
  } catch (error) {
    bookingError = error instanceof Error ? error.message : String(error);
  }

  const result: ResearchResult = { ...analysis, bookingMessageSent, bookingError };
  await appendResearchRow(result);

  return result;
}

/** True once this lead has a Rejections row. */
export async function isRejected(leadId: string): Promise<boolean> {
  const rejected = await listRejectedLeadIds();
  return rejected.has(leadId);
}

/** Marks a lead as not being pursued. No research, no message — just the record. */
export async function rejectLead(leadId: string): Promise<void> {
  const row = await findLeadRowById(leadId);
  if (!row) throw new Error(`No lead found with id ${leadId}`);
  await appendRejection(leadId);
}

/**
 * Records where a sales conversation got to, after the booking message went
 * out. Purely a log entry sales sets by hand from the drawer — nothing here
 * infers it from WhatsApp or Calendly.
 */
export async function setOutcome(leadId: string, outcome: Outcome): Promise<void> {
  const row = await findLeadRowById(leadId);
  if (!row) throw new Error(`No lead found with id ${leadId}`);
  await appendOutcome(leadId, outcome);
}

/** Rebuilds enough of a Lead + ExtractedLead from a Sheet row to run research on. */
function toLeadAndExtracted(row: LeadRecord): { lead: Lead; extracted: ExtractedLead } {
  const lead: Lead = {
    id: row.id,
    channel: row.channel === "whatsapp" ? "whatsapp" : "form",
    from: row.phone || null,
    message: row.message,
    receivedAt: row.receivedAt,
    website: row.website,
    instagramHandle: row.instagram,
  };

  const extracted: ExtractedLead = {
    ...EMPTY_EXTRACTION,
    customer_name: row.customerName || null,
    company: row.company || null,
    phone: row.phone || null,
    email: row.email || null,
    service: row.service || null,
    budget_amount: row.budgetAmount ? Number(row.budgetAmount) : null,
    budget_currency: row.budgetCurrency === "USD" ? "USD" : row.budgetCurrency === "INR" ? "INR" : null,
    timeline: row.timeline || null,
  };

  return { lead, extracted };
}
