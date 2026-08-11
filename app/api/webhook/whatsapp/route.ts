import crypto from "node:crypto";
import { after } from "next/server";
import { normalizeWhatsApp } from "@/lib/normalize";
import { processLead } from "@/lib/pipeline";

/**
 * Meta's webhook endpoint.
 *
 * GET  — one-time verification handshake when you register the URL.
 * POST — inbound messages. Must return 200 fast: Meta retries anything slow
 *        or failing, and a retry storm during a demo means duplicate rows.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    // Meta requires the raw challenge string, not JSON.
    return new Response(challenge ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  // The signature covers the exact bytes Meta sent, so read the body as text
  // and parse it ourselves rather than calling request.json() first.
  const raw = await request.text();

  if (!isValidSignature(raw, request.headers.get("x-hub-signature-256"))) {
    return new Response("Invalid signature", { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    // Acknowledge anyway — retrying malformed JSON will not help Meta.
    return Response.json({ ok: true, ignored: "unparseable body" });
  }

  const leads = normalizeWhatsApp(body);

  // Everything heavy happens after the response is flushed.
  after(async () => {
    for (const lead of leads) {
      try {
        const outcome = await processLead(lead);
        console.log("[lead]", {
          id: outcome.lead.id,
          status: outcome.result.status,
          score: outcome.result.score,
          skipped: outcome.skipped,
          followUpSent: outcome.followUpSent,
          latencyMs: outcome.latencyMs,
          error: outcome.error,
        });
      } catch (error) {
        console.error("[lead] pipeline failed", lead.id, error);
      }
    }
  });

  return Response.json({ ok: true, received: leads.length });
}

/**
 * Verifies the payload really came from Meta. Without this, anyone who learns
 * the URL can inject leads.
 */
function isValidSignature(raw: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;

  // Local development without a secret configured: warn, but let it through
  // so the loop can be tested before the Meta app is fully wired up.
  if (!secret) {
    if (process.env.NODE_ENV === "production") return false;
    console.warn("[webhook] WHATSAPP_APP_SECRET unset — skipping signature check");
    return true;
  }

  if (!header?.startsWith("sha256=")) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(raw, "utf8")
    .digest("hex");
  const received = header.slice("sha256=".length);

  // Length check first: timingSafeEqual throws on a length mismatch.
  if (received.length !== expected.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(received, "hex"),
    Buffer.from(expected, "hex"),
  );
}
