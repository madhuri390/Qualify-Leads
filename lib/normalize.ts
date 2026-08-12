import { z } from "zod";
import type { Lead } from "./types";

/**
 * Both channels collapse into one Lead here, so everything downstream —
 * extract, score, sheet, notify — only ever deals with a single shape.
 */

/**
 * The slice of Meta's webhook envelope we actually use. Loose on purpose:
 * Meta sends status callbacks (delivered/read) through the same endpoint and
 * those have no `messages` array at all.
 */
const WhatsAppWebhookSchema = z.object({
  object: z.string().optional(),
  entry: z
    .array(
      z.object({
        changes: z
          .array(
            z.object({
              value: z.object({
                messages: z
                  .array(
                    z.object({
                      id: z.string(),
                      from: z.string(),
                      timestamp: z.string().optional(),
                      type: z.string(),
                      text: z.object({ body: z.string() }).optional(),
                    }),
                  )
                  .optional(),
              }),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

export type WhatsAppWebhookBody = z.infer<typeof WhatsAppWebhookSchema>;

/**
 * Pulls every inbound text message out of a webhook payload.
 * Status callbacks and non-text messages yield an empty array — not an error.
 */
export function normalizeWhatsApp(body: unknown): Lead[] {
  const parsed = WhatsAppWebhookSchema.safeParse(body);
  if (!parsed.success) return [];

  const leads: Lead[] = [];
  for (const entry of parsed.data.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value.messages ?? []) {
        // Voice notes and images are a stretch goal; text only for now.
        if (message.type !== "text" || !message.text?.body) continue;
        leads.push({
          id: message.id,
          channel: "whatsapp",
          from: message.from,
          message: message.text.body,
          receivedAt: message.timestamp
            ? new Date(Number(message.timestamp) * 1000).toISOString()
            : new Date().toISOString(),
        });
      }
    }
  }
  return leads;
}

export const FormLeadSchema = z.object({
  message: z.string().trim().min(1, "Tell us what you need").max(4000),
  name: z.string().trim().max(200).optional(),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(50).optional(),
  company: z.string().trim().max(200).optional(),
  /** Free text as typed — "₹1,50,000", "500 dollars". Gemini reads the number. */
  budget: z.string().trim().max(100).optional(),
  service: z.string().trim().max(200).optional(),
  timing: z.string().trim().max(100).optional(),
});

export type FormLeadInput = z.infer<typeof FormLeadSchema>;

/**
 * Form fields are appended to the message rather than written straight into
 * the extraction, so the LLM sees one coherent enquiry and the scorer stays
 * fed by a single source.
 */
export function normalizeForm(input: FormLeadInput): Lead {
  const context = [
    input.name && `Name: ${input.name}`,
    input.email && `Email: ${input.email}`,
    input.phone && `Phone: ${input.phone}`,
    input.company && `Company: ${input.company}`,
    input.budget && `Budget: ${input.budget}`,
    input.service && `Service: ${input.service}`,
    input.timing && `Timing: ${input.timing}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    id: `form:${crypto.randomUUID()}`,
    channel: "form",
    from: input.phone?.replace(/\D/g, "") || null,
    message: context ? `${context}\n\n${input.message}` : input.message,
    receivedAt: new Date().toISOString(),
  };
}
