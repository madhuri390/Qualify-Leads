import { extractLead } from "./extract";
import { askFollowUp, notifySales } from "./notify";
import { scoreLead } from "./score";
import { appendLeadRow, hasSeenMessage } from "./sheets";
import { EMPTY_EXTRACTION, type ExtractedLead, type Lead, type ScoreResult } from "./types";

/**
 * The whole loop, in one place: extract → score → append → notify.
 *
 * Runs after the HTTP response has been sent (see the webhook route), so it
 * must never throw into the caller — every failure ends up as a Sheet row a
 * human can act on.
 */

export interface PipelineOutcome {
  lead: Lead;
  extracted: ExtractedLead;
  result: ScoreResult;
  skipped?: "duplicate";
  followUpSent?: boolean;
  error?: string;
  latencyMs: number;
}

export async function processLead(lead: Lead): Promise<PipelineOutcome> {
  const startedAt = Date.now();

  if (await hasSeenMessage(lead.id)) {
    // Meta retried a webhook we already handled. Appending again would put a
    // duplicate row on screen.
    return {
      lead,
      extracted: EMPTY_EXTRACTION,
      result: scoreLead(EMPTY_EXTRACTION),
      skipped: "duplicate",
      latencyMs: Date.now() - startedAt,
    };
  }

  const extraction = await extractLead(lead.message);
  const result = extraction.ok
    ? scoreLead(extraction.lead)
    : { ...scoreLead(extraction.lead), status: "Needs Review" as const };

  // The row goes down first. Notifications are best-effort on top of it — a
  // failed WhatsApp send must not cost us the record of the lead.
  await appendLeadRow({
    lead,
    extracted: extraction.lead,
    result,
    error: extraction.error,
  });

  let followUpSent = false;
  const notifyErrors: string[] = [];

  try {
    await notifySales(lead, extraction.lead, result);
  } catch (error) {
    notifyErrors.push(messageOf(error));
  }

  try {
    followUpSent = await askFollowUp(lead, result);
  } catch (error) {
    notifyErrors.push(messageOf(error));
  }

  return {
    lead,
    extracted: extraction.lead,
    result,
    followUpSent,
    error: [extraction.error, ...notifyErrors].filter(Boolean).join(" | ") || undefined,
    latencyMs: Date.now() - startedAt,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
