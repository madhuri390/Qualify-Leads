@AGENTS.md

# Qualify Leads — AI Lead Qualification Agent

Day 1 of a 30-day build sprint. Built for **learning and a build-in-public Instagram post**,
not for a paying client. That shapes every tradeoff below: the result must be visible on
screen, verifiable by hand, and run on free tiers.

Read `Day_01_AI_Lead_Qualification_Agent.md` for the product spec and
`BUILD_CHECKLIST.md` for current progress. This file is how we build it.

---

## The Loop

```
WhatsApp message / website form
  → normalize to one Lead shape
  → Gemini extracts structured fields   ← the only LLM step
  → score.ts applies the rubric         ← pure code, no LLM
  → append row to Google Sheet
  → WhatsApp alert back to the sales number
```

Build it in that order. Each stage must work end-to-end before starting the next.

---

## Tech Stack — Locked

| Layer | Choice | Notes |
|---|---|---|
| App | Next.js (App Router) + TypeScript | One deployable. API routes are the backend. |
| LLM | Gemini free tier | Structured output mode, not prompt-begging for JSON |
| Datastore | Google Sheet | Append-only. The Sheet *is* the dashboard. |
| Inbound | WhatsApp Cloud API + web form | Cloud API setup already done |
| Notify | WhatsApp message back | Not email — reuses code we already have |
| Hosting | Vercel | Needed from day one for the webhook URL |
| Validation | Zod | Every LLM response and webhook payload |

**Do not propose:** Trigger.dev, n8n, Supabase, Postgres, Prisma, Slack, email providers,
Telegram, or a separate Node backend. All were considered and rejected. Re-proposing them
wastes turns.

---

## Non-Negotiable Rules

### 1. The LLM extracts. Code scores.

Gemini returns **facts only** — budget, timeline, service, decision-maker status. It never
returns a score, a status, or a next action. `lib/score.ts` turns facts into a number.

Why: the spec's original example emitted `"score": 92`, which the rubric can't even produce
(all point values are multiples of 10). A model inventing numbers is unauditable and
untestable. A pure function is both.

`score.ts` must be a **pure function** — no I/O, no async, no network. It is the piece that
makes this engineering rather than an API wrapper. Unit test it.

### 2. Structured output, then validate anyway

Call Gemini with `responseMimeType: "application/json"` and an explicit `responseSchema`.
Then still parse the result through Zod. The schema constrains; Zod proves.

Never write "return JSON only" in a prompt and hope.

### 3. Webhooks return 200 immediately

Meta retries any webhook that errors or responds slowly. Acknowledge first, process after.
A Gemini call inside the request handler will trigger retries mid-demo.

### 4. Dedupe every inbound message

Store the WhatsApp `wamid` in a Sheet column. Skip anything already seen. Sheet appends are
not idempotent — retries mean duplicate rows, and duplicate rows on camera kill the demo.

### 5. Sheet writes are append-only

No read-modify-write. No cell updates. Append a row, always. This sidesteps every
concurrency problem the Sheets API has and keeps a full audit trail of what the agent saw.

### 6. Fail loud, never silently

If Gemini returns something unparseable, write the row anyway with `status: "needs_review"`
and the raw text in an error column. A lead that reaches a human beats a lead that vanishes
into a swallowed exception.

---

## Project Structure

```
app/
  api/webhook/whatsapp/route.ts   GET = Meta verification, POST = inbound message
  api/leads/route.ts              website form submissions
  page.tsx                        demo form + live lead table
lib/
  types.ts                        the Lead shape both channels normalize into
  normalize.ts                    WhatsApp payload | form body → Lead
  extract.ts                      Gemini call + Zod schema
  score.ts                        the rubric — PURE, no I/O
  sheets.ts                       append-only writes
  notify.ts                       WhatsApp alert to the sales number
fixtures/leads.json               ~20 dummy leads + hand-written expected output
scripts/eval.ts                   runs fixtures, prints extraction accuracy
```

One concern per file. If `extract.ts` starts scoring, split it.

---

## Environment Variables

Every secret lives in `.env.local`, which is gitignored via `.env*`. See
`.env.local.example` for the full list with instructions on where each value comes from.

Rules:
- Validate at the top of any module that needs one — throw with the variable's name.
- Never log a secret value, not even truncated.
- Never hardcode a token, phone number ID, or sheet ID. Not temporarily, not in a comment.
- Every var added locally must also go into Vercel → Project → Settings → Environment
  Variables. Missing prod env vars are the #1 cause of "it worked locally."

---

## Platform Constraints to Design Around

- **WhatsApp test number** can only message ~5 pre-verified recipients. Add your own number
  and the sales alert number to the allowlist early, not on demo day.
- **24-hour session window** — outside it, only approved template messages send. Fine for
  this build since we always reply to an inbound message.
- **Gemini free tier** is roughly 15 requests/minute. Never a problem for a demo; will be
  one if `scripts/eval.ts` fires 20 fixtures in a tight loop. Add a small delay.
- **Google Sheets API** needs the sheet shared with the service-account email as Editor.
  Forgetting this produces a confusing 403.
- **Vercel** functions are stateless — no in-memory dedupe cache. The `wamid` column is the
  dedupe store.

---

## Money Metric

The deliverable needs one verifiable number. It comes from `scripts/eval.ts`:

> 20 hand-written dummy leads, each with expected extraction output.
> Run them through the real pipeline. Print field-level accuracy.

Also measure and print real end-to-end latency. Don't claim "under 30 seconds" — Gemini
Flash does this in ~2s, so show the actual figure.

Do not report a number that hasn't actually been produced by running the eval.

---

## Working Style

- Dummy leads only. No real-market sourcing or labelling effort — the fixtures exist to
  teach and to prove accuracy.
- Deploy to Vercel early so the webhook has a stable HTTPS URL. Don't build behind ngrok
  and discover deployment problems at the end.
- Never commit, push, or deploy without being asked.
- Prefer boring, readable code. This gets screen-recorded and read by strangers.

---

## The Shot We're Building Toward

Phone sending a WhatsApp message on the left, Google Sheet row appearing colour-coded
green / amber / red on the right, alert buzzing back on the phone. Every technical decision
should protect that 15 seconds of footage.
