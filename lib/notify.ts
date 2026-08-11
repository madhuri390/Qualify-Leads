import { requireEnv } from "./env";
import type { ExtractedLead, Lead, ScoreResult } from "./types";
import { formatBreakdown } from "./score";

/**
 * Outbound WhatsApp. Used for two things: alerting sales on a qualified lead,
 * and asking a follow-up question when one missing field is holding a lead
 * back. Email would have meant another account and another failure mode for
 * a channel nobody sees in the demo.
 */

const GRAPH_API = "https://graph.facebook.com/v22.0";

async function sendText(to: string, body: string): Promise<void> {
  const phoneNumberId = requireEnv("WHATSAPP_PHONE_NUMBER_ID");
  const token = requireEnv("WHATSAPP_ACCESS_TOKEN");

  const response = await fetch(`${GRAPH_API}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });

  if (!response.ok) {
    // Never include the token in the message — this string gets logged.
    throw new Error(
      `WhatsApp send failed (${response.status}): ${await response.text()}`,
    );
  }
}

const STATUS_ICON: Record<string, string> = {
  Qualified: "🟢",
  "Follow-up": "🟡",
  Reject: "🔴",
  "Needs Review": "⚪",
};

/**
 * Alerts sales. Qualified only — alerting on every reject trains the team to
 * ignore the channel.
 */
export async function notifySales(
  lead: Lead,
  extracted: ExtractedLead,
  result: ScoreResult,
): Promise<void> {
  if (result.status !== "Qualified") return;

  const who = extracted.company ?? extracted.customer_name ?? "Unknown";
  const lines = [
    `${STATUS_ICON[result.status]} *${result.status} lead — ${result.score}/100*`,
    "",
    `*${who}*`,
    extracted.service && `Wants: ${extracted.service}`,
    extracted.budget_amount &&
      `Budget: ${extracted.budget_currency ?? "INR"} ${extracted.budget_amount.toLocaleString("en-IN")}`,
    extracted.timeline && `Timeline: ${extracted.timeline}`,
    lead.from && `Contact: +${lead.from}`,
    "",
    `Score: ${formatBreakdown(result)}`,
    `Next: ${result.next_action}`,
  ].filter(Boolean);

  await sendText(requireEnv("SALES_ALERT_NUMBER"), lines.join("\n"));
}

/**
 * The differentiator: when a lead falls short on exactly one criterion, ask
 * that one question instead of filing it and moving on. Answering re-scores
 * the lead, so an amber row turns green on camera.
 */
export async function askFollowUp(
  lead: Lead,
  result: ScoreResult,
): Promise<boolean> {
  if (lead.channel !== "whatsapp" || !lead.from) return false;
  if (result.status !== "Follow-up" || !result.biggest_gap) return false;

  const question = FOLLOW_UP_QUESTIONS[result.biggest_gap];
  if (!question) return false;

  await sendText(lead.from, question);
  return true;
}

const FOLLOW_UP_QUESTIONS: Record<string, string> = {
  budget:
    "Thanks for reaching out! To point you at the right option — what budget range are you working with for this?",
  clear_requirement:
    "Happy to help! Could you tell me a bit more about what you want built, so I can give you an accurate quote?",
  urgent_timeline:
    "Thanks! When are you looking to get started — this month, or further out?",
  business_email:
    "Great, thanks! What's the best work email to send the proposal to?",
  decision_maker:
    "Thanks! Just so I loop in the right people — will you be the one signing off on this?",
};
