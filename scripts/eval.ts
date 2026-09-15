/**
 * Runs every fixture through the real extractor and prints field-level
 * accuracy. This is the number the build is judged on, so it must come from
 * actually calling the model — never from a stored result.
 *
 *   npm run eval
 *   npm run eval -- --only tenglish
 *   npm run eval -- --delay 6000
 *
 * Calls `extractLead` directly rather than `processLead`: an eval run must not
 * write rows to the Sheet or fire WhatsApp alerts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import "./load-env";
import { extractLead } from "../lib/extract";
import { scoreLead } from "../lib/score";
import { EMPTY_EXTRACTION, type ExtractedLead } from "../lib/types";

/** Drive the score, so a near miss is a miss. */
const EXACT_FIELDS = [
  "budget_amount",
  "budget_currency",
  "urgency",
  "requirement_clarity",
  "is_decision_maker",
] as const;

/** Free text — the schema wants the sender's phrasing, the prompt wants English. */
const FUZZY_FIELDS = ["service", "timeline", "customer_name", "company", "email"] as const;

type Field = (typeof EXACT_FIELDS)[number] | (typeof FUZZY_FIELDS)[number];

interface Fixture {
  id: string;
  language: string;
  note: string;
  message: string;
  expected: Partial<ExtractedLead>;
  expected_score: number;
  expected_status: string;
}

/**
 * The free tier for this model allows **5 requests per minute and 20 per day**
 * — measured off a 429, not off the docs. 13s between calls stays under the
 * per-minute limit with room to spare.
 *
 * The daily cap is the real constraint: a 20-fixture run consumes an entire
 * day's quota in one go, and every WhatsApp message or form submission you test
 * spends from the same budget. Plan reruns accordingly.
 */
const DEFAULT_DELAY_MS = 13_000;

/** Give a rate-limited call a couple of chances before writing it off. */
const MAX_RETRIES = 2;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

/** Words that carry no meaning for comparing two descriptions of the same thing. */
const STOPWORDS = new Set([
  "a", "an", "the", "for", "with", "and", "of", "to", "our", "my", "we", "us",
  "in", "on", "system", "development",
]);

const tokens = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));

/**
 * Free-text fields match on token overlap rather than substring. "WhatsApp bot
 * for clinic reminders" and "WhatsApp bot development" describe the same thing;
 * a containment check calls that a miss and blames the model for the matcher.
 */
function fuzzyMatch(expected: unknown, actual: unknown): boolean {
  if (expected === null || expected === undefined) return actual === null;
  if (typeof expected !== "string" || typeof actual !== "string") return false;

  const a = tokens(expected);
  const b = tokens(actual);
  if (a.length === 0 || b.length === 0) return a.length === b.length;

  const shared = a.filter((word) => b.includes(word)).length;
  return shared / Math.min(a.length, b.length) >= 0.5;
}

function exactMatch(expected: unknown, actual: unknown): boolean {
  return (expected ?? null) === (actual ?? null);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const path = join(import.meta.dirname, "..", "fixtures", "leads.json");
  const all = JSON.parse(readFileSync(path, "utf8")) as Fixture[];

  const only = arg("only");
  const fixtures = only ? all.filter((f) => f.language === only) : all;
  if (fixtures.length === 0) {
    console.error(only ? `No fixtures with language "${only}"` : "No fixtures found");
    process.exit(1);
  }

  const delay = Number(arg("delay") ?? DEFAULT_DELAY_MS);
  console.log(`Running ${fixtures.length} fixtures against the live model, ${delay}ms apart.\n`);

  const hits = new Map<Field, number>();
  const total = new Map<Field, number>();
  const latencies: number[] = [];
  let statusHits = 0;
  let failures = 0;

  for (const [index, fixture] of fixtures.entries()) {
    const result = await extractWithRetry(fixture.message, delay);

    // A call that never reached the model says nothing about extraction
    // quality, and counting it would quietly flatter every all-null fixture.
    // Excluded from accuracy, reported on its own.
    if (!result.ok) {
      failures++;
      console.log(`SKIP ${fixture.id.padEnd(34)} extraction failed — excluded from accuracy`);
      console.log(`    ${result.error?.slice(0, 160)}`);
      if (index < fixtures.length - 1) await sleep(delay);
      continue;
    }

    latencies.push(result.latencyMs);
    const misses: string[] = [];
    const check = (field: Field, matched: boolean) => {
      total.set(field, (total.get(field) ?? 0) + 1);
      if (matched) hits.set(field, (hits.get(field) ?? 0) + 1);
      else {
        misses.push(
          `    ${field.padEnd(20)} expected ${format(fixture.expected[field])}  got ${format(result.lead[field])}`,
        );
      }
    };

    for (const field of EXACT_FIELDS) {
      check(field, exactMatch(fixture.expected[field], result.lead[field]));
    }
    for (const field of FUZZY_FIELDS) {
      check(field, fuzzyMatch(fixture.expected[field], result.lead[field]));
    }

    // The status is what a human would act on, so track it separately from the
    // fields that produced it.
    const scored = scoreLead({ ...EMPTY_EXTRACTION, ...result.lead });
    const statusOk = scored.status === fixture.expected_status;
    if (statusOk) statusHits++;

    const flag = misses.length === 0 && statusOk ? "ok  " : "MISS";
    console.log(
      `${flag} ${fixture.id.padEnd(34)} ${String(scored.score).padStart(3)} ${scored.status.padEnd(10)}` +
        ` ${(result.latencyMs / 1000).toFixed(1)}s` +
        (statusOk ? "" : `  <-- expected ${fixture.expected_status} (${fixture.expected_score})`),
    );
    misses.forEach((line) => console.log(line));

    if (index < fixtures.length - 1) await sleep(delay);
  }

  report(hits, total, latencies, statusHits, fixtures.length, failures);
}

/**
 * Retries only rate limits. A malformed response is a real result and must not
 * be retried away — that would hide exactly what the eval exists to measure.
 */
async function extractWithRetry(message: string, delay: number) {
  for (let attempt = 0; ; attempt++) {
    const result = await extractLead(message);
    const rateLimited = result.error?.includes("RESOURCE_EXHAUSTED");

    if (result.ok || !rateLimited || attempt >= MAX_RETRIES) return result;

    const wait = delay * (attempt + 2);
    console.log(`     rate limited, waiting ${(wait / 1000).toFixed(0)}s before retry…`);
    await sleep(wait);
  }
}

function format(value: unknown): string {
  if (value === null || value === undefined) return "null";
  return typeof value === "string" ? `"${value}"` : String(value);
}

function report(
  hits: Map<Field, number>,
  total: Map<Field, number>,
  latencies: number[],
  statusHits: number,
  count: number,
  failures: number,
) {
  console.log("\nFIELD ACCURACY");
  let hitSum = 0;
  let totalSum = 0;

  for (const field of [...EXACT_FIELDS, ...FUZZY_FIELDS]) {
    const hit = hits.get(field) ?? 0;
    const seen = total.get(field) ?? 0;
    if (seen === 0) continue;
    hitSum += hit;
    totalSum += seen;
    const pct = Math.round((hit / seen) * 100);
    const kind = (EXACT_FIELDS as readonly string[]).includes(field) ? "exact" : "fuzzy";
    console.log(
      `  ${field.padEnd(20)} ${String(hit).padStart(3)}/${seen}  ${String(pct).padStart(3)}%  ${kind}`,
    );
  }

  const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const sorted = [...latencies].sort((a, b) => a - b);

  const scored = count - failures;
  console.log(
    `\nOVERALL   ${Math.round((hitSum / totalSum) * 100)}%  (${hitSum}/${totalSum} fields across ${scored} fixtures)`,
  );
  console.log(
    `STATUS    ${statusHits}/${scored} fixtures landed on the expected status`,
  );
  console.log(
    `LATENCY   mean ${(mean / 1000).toFixed(1)}s  median ${(sorted[Math.floor(sorted.length / 2)] / 1000).toFixed(1)}s  max ${(sorted.at(-1)! / 1000).toFixed(1)}s`,
  );
  if (failures > 0) {
    console.log(
      `EXCLUDED  ${failures} of ${count} call(s) never reached the model — the accuracy` +
        `\n          above covers only the ${count - failures} that did. Not a full-set result.`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
