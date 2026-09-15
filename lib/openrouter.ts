import { requireEnv } from "./env";

/**
 * Shared OpenRouter chat-completions call, used by extract.ts and
 * research.ts — the two places that ask an LLM for structured JSON.
 *
 * OpenRouter over a direct provider SDK: one key covers every model the
 * project might switch to, and it's a plain REST call — no SDK to add.
 *
 * Switched here a second time: direct Gemini kept 503ing ("high demand")
 * even on a fresh, correctly-billed key — a real-world reliability problem,
 * not a config bug. Free-tier model, chosen deliberately over a paid one:
 * $0/token. Nemotron 3 Super documents real `response_format` support, so
 * structured output stays provider-enforced rather than falling back to
 * schema-in-prompt.
 *
 * Free-tier rate limits aren't documented for this specific model; assume
 * the OpenRouter default (20 req/min, 50 req/day, 1,000/day after a $10
 * top-up) until proven otherwise. A 429 here surfaces as a normal
 * extraction failure ("Needs Review" status), not a crash.
 */
export const MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

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
  // Real structured output when the provider honors response_format, plus a
  // schema-in-prompt + code-fence-stripped fallback that costs nothing when
  // it isn't needed — belt and suspenders across providers that vary in
  // what they actually support (the last free model rejected
  // response_format entirely; this one documents support for it).
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
        response_format: {
          type: "json_schema",
          json_schema: { name: params.schemaName, strict: true, schema: params.jsonSchema },
        },
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
