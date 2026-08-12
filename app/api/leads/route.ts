import { FormLeadSchema, normalizeForm } from "@/lib/normalize";
import { processLead } from "@/lib/pipeline";

/**
 * Website form submissions. Same pipeline as WhatsApp, different front door:
 * the body is normalized into the one `Lead` shape and handed straight to
 * `processLead`.
 */

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
