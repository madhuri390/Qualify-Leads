import { FormLeadSchema, normalizeForm } from "@/lib/normalize";
import { processLead } from "@/lib/pipeline";
import {
  listApprovedLeadIds,
  listRejectedLeadIds,
  readLatestOutcomes,
  readLeadRows,
  readResearchRows,
  type Outcome,
} from "@/lib/sheets";

/**
 * Website form submissions (POST). Same pipeline as WhatsApp, different
 * front door: the body is normalized into the one `Lead` shape and handed
 * straight to `processLead`.
 *
 * GET powers the dashboard: Qualified/Follow-up leads joined against the
 * Approvals, Research, Rejections, and Outcomes tabs into one funnel
 * `stage` per lead — Pending / Approved / Scheduling / Interested /
 * Call Scheduled — computed here rather than stored as a mutable flag
 * anywhere. Rejected leads are dropped entirely, not shown with a status.
 */

export type Stage = "Pending" | "Approved" | "Scheduling" | "Interested" | "Call Scheduled";

function stageFor(approved: boolean, bookingSent: boolean, outcome: Outcome | undefined): Stage {
  if (!approved) return "Pending";
  if (outcome) return outcome;
  return bookingSent ? "Scheduling" : "Approved";
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The demo page is served from disk (origin `null`) or a static server on
 * another port, so every submission is cross-origin. No cookies or auth are
 * involved, and the endpoint is already publicly reachable, so a wildcard
 * gives away nothing the URL does not.
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

/** Read-only, used by the dashboard. Not CORS-restricted to the dashboard's
 * own origin for the same reason as the form: no cookies, no auth. */
export async function GET() {
  const [leads, approvedIds, rejectedIds, researchRows, outcomes] = await Promise.all([
    readLeadRows(),
    listApprovedLeadIds(),
    listRejectedLeadIds(),
    readResearchRows(),
    readLatestOutcomes(),
  ]);

  const researchByLeadId = new Map(researchRows.map((r) => [r.leadId, r]));

  const dashboardLeads = leads
    .filter((lead) => lead.status === "Qualified" || lead.status === "Follow-up")
    .filter((lead) => !rejectedIds.has(lead.id))
    .map((lead) => {
      const approved = approvedIds.has(lead.id);
      const research = researchByLeadId.get(lead.id) ?? null;
      const stage = stageFor(approved, research?.bookingMessageSent === "true", outcomes.get(lead.id));
      return { ...lead, approved, research, stage };
    })
    .reverse(); // newest first — the Sheet appends oldest-first.

  const stats = {
    total: dashboardLeads.length,
    pendingApproval: dashboardLeads.filter((l) => l.stage === "Pending").length,
    approved: dashboardLeads.filter((l) => l.stage !== "Pending").length,
    callsScheduled: dashboardLeads.filter((l) => l.stage === "Call Scheduled").length,
  };

  return Response.json({ ok: true, leads: dashboardLeads, stats }, { headers: CORS });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { ok: false, error: "Expected a JSON body" },
      { status: 400, headers: CORS },
    );
  }

  const parsed = FormLeadSchema.safeParse(body);
  if (!parsed.success) {
    // Surface the first field message so the form can print it verbatim.
    return Response.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid submission" },
      { status: 400, headers: CORS },
    );
  }

  const lead = normalizeForm(parsed.data);

  // Unlike the WhatsApp webhook there is no platform retrying on a slow reply,
  // so the visitor waits for the real outcome instead of a bare acknowledgement.
  try {
    const outcome = await processLead(lead);
    console.log("[lead]", {
      id: outcome.lead.id,
      channel: "form",
      status: outcome.result.status,
      score: outcome.result.score,
      latencyMs: outcome.latencyMs,
      error: outcome.error,
    });

    return Response.json(
      {
        ok: true,
        id: lead.id,
        status: outcome.result.status,
        score: outcome.result.score,
        latencyMs: outcome.latencyMs,
      },
      { headers: CORS },
    );
  } catch (error) {
    // Reaching here means the row was never written, so say so rather than
    // showing the visitor a success screen for a lead nobody will ever see.
    console.error("[lead] pipeline failed", lead.id, error);
    return Response.json(
      { ok: false, error: "Could not file the enquiry" },
      { status: 500, headers: CORS },
    );
  }
}
