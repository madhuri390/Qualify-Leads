import { requireEnv } from "./env";

/**
 * Shared OpenRouter chat-completions call, used by extract.ts and
 * research.ts — the two places that ask an LLM for structured JSON.
 *
 * OpenRouter over a direct provider SDK: one key covers every model the
 * project might switch to, and it's a plain REST call — no SDK to add.
 *
 * Free-tier model, chosen deliberately over a paid one: $0/token, but
 * capped at 20 req/min and 50 req/day (1,000/day after a one-time $10
 * top-up — not something this project has done). A burst of leads, or
 * running scripts/eval.ts's 20 fixtures back-to-back, can hit that daily
 * cap; a 429 here surfaces as a normal extraction failure ("Needs Review"
 * status), not a crash.
 */
export const MODEL = "inclusionai/ling-3.0-flash-vl:free";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface CompletionResult {
  text: string | null;
  error?: string;
}

export async function completeJson(params: {
  systemInstruction: string;
  content: string;
  jsonSchema: unknown;
  schemaName: string;
}): Promise<CompletionResult> {
  // Would prefer `response_format: json_schema` (provider-enforced, the
  // Zod-generated schema goes straight in) or at least `json_object`. The
  // free model's provider (routed through Novita) rejects BOTH outright —
  // "does not support feature: structured-outputs" — so this falls back to
  // the one thing every chat model supports: the schema as prompt text, no
  // response_format at all. This is exactly the "prompt and hope" pattern
  // CLAUDE.md warns against — accepted here only because the free model
  // leaves no alternative. Zod still validates every response either way;
  // stripCodeFence below handles the markdown-fence wrapping this mode
  // needs that structured-output mode never did.
  const schemaText = JSON.stringify(params.jsonSchema, null, 2);
  const systemInstruction = `${params.systemInstruction}\n\nRespond with ONLY a single JSON object matching exactly this schema — no markdown code fences, no prose before or after it:\n${schemaText}`;

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireEnv("OPENROUTER_API_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        // Deterministic-as-possible; the same enquiry should extract the
        // same fields across eval runs.
        temperature: 0,
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: params.content },
        ],
      }),
    });

    if (!response.ok) {
      return { text: null, error: `OpenRouter ${response.status}: ${await response.text()}` };
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content ?? null;
    return { text: raw ? stripCodeFence(raw) : null };
  } catch (error) {
    return {
      text: null,
      error: error instanceof Error ? error.message : "Unknown OpenRouter error",
    };
  }
}

/** Strips a ```json ... ``` (or bare ```...```) wrapper some models add despite being told not to. */
function stripCodeFence(text: string): string {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : text.trim();
}
