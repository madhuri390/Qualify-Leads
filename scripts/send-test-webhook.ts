/**
 * Fires a realistic WhatsApp webhook payload at a running dev server, so the
 * whole pipeline can be exercised without Meta, a tunnel, or a real phone.
 *
 *   npm run dev                        # in one terminal
 *   npm run webhook:test               # in another
 *   npm run webhook:test -- "custom enquiry text here"
 *
 * Signs the request when WHATSAPP_APP_SECRET is set, so the signature path
 * gets tested too rather than only the dev-mode bypass.
 */
import crypto from "node:crypto";
import "./load-env";

const URL_ = process.env.WEBHOOK_URL ?? "http://localhost:3000/api/webhook/whatsapp";

const DEFAULT_MESSAGE =
  "Hi, we run a dental clinic with four branches and want an AI chatbot for " +
  "appointment booking and WhatsApp reminders. Budget is around 2.5 lakhs and " +
  "we'd like to launch this month. I'm the owner.";

const message = process.argv[2] ?? DEFAULT_MESSAGE;

const payload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "test-entry",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: "15550000000",
              phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "test",
            },
            messages: [
              {
                // Unique each run, otherwise the dedupe check correctly skips it.
                id: `wamid.TEST${Date.now()}`,
                from: process.env.SALES_ALERT_NUMBER ?? "919999999999",
                timestamp: String(Math.floor(Date.now() / 1000)),
                type: "text",
                text: { body: message },
              },
            ],
          },
        },
      ],
    },
  ],
};

async function main() {
  const raw = JSON.stringify(payload);
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  const secret = process.env.WHATSAPP_APP_SECRET;
  if (secret) {
    const digest = crypto.createHmac("sha256", secret).update(raw, "utf8").digest("hex");
    headers["X-Hub-Signature-256"] = `sha256=${digest}`;
    console.log("→ signed with WHATSAPP_APP_SECRET");
  } else {
    console.log("→ unsigned (dev bypass; production would reject this)");
  }

  console.log(`→ POST ${URL_}`);
  console.log(`→ "${message.slice(0, 70)}${message.length > 70 ? "…" : ""}"\n`);

  const response = await fetch(URL_, { method: "POST", headers, body: raw });
  console.log(`← ${response.status} ${await response.text()}`);
  console.log("\nThe pipeline runs after the response — watch the dev server logs.");
}

main().catch((error) => {
  console.error("✗ Failed:", error instanceof Error ? error.message : error);
  console.error("  Is the dev server running? (npm run dev)");
  process.exit(1);
});
