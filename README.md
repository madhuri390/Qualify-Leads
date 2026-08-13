# Qualify Leads

An AI agent that reads an inbound enquiry — from WhatsApp or a website form —
pulls the facts out of it, scores it against a fixed rubric, files it in a Google
Sheet and pings sales when it's worth their time.

Day 1 of a 30-day build sprint. Built to learn in public, so the code is meant to
be read.

```
WhatsApp message / website form
  → normalize to one Lead shape
  → Gemini extracts structured fields   ← the only LLM step
  → score.ts applies the rubric         ← pure code, no LLM
  → append row to Google Sheet
  → WhatsApp alert back to the sales number
```

## The one idea worth stealing

**The model extracts. Code scores.**

Gemini only ever returns facts — budget, timeline, service, whether the sender
can sign off. It never returns a score, a status or a next action. `lib/score.ts`
turns those facts into a number, and it's a pure function: no I/O, no async, no
network. Same input, same score, every time.

The spec this was built from originally had the model emit `"score": 92`. The
rubric can't even produce 92 — every value in it is a multiple of 10. A model
inventing numbers is unauditable and untestable. A pure function is both, which
is why the rubric has 33 unit tests and the prompt has none.

Extraction is called with `responseMimeType: "application/json"` and an explicit
schema, and the reply is *still* parsed through Zod. The schema constrains; Zod
proves.

## Stack

| Layer | Choice |
|---|---|
| App | Next.js (App Router) + TypeScript — one deployable, API routes are the backend |
| LLM | Gemini, structured output mode |
| Datastore | Google Sheet, append-only — the Sheet *is* the dashboard |
| Inbound | WhatsApp Cloud API + web form |
| Notify | WhatsApp message back to sales |
| Hosting | Vercel |
| Validation | Zod on every LLM response and webhook payload |

## Layout

```
app/
  api/webhook/whatsapp/route.ts   GET = Meta verification, POST = inbound message
  api/leads/route.ts              website form submissions
lib/
  types.ts        the Lead shape both channels normalize into
  normalize.ts    WhatsApp payload | form body → Lead
  extract.ts      Gemini call + Zod schema
  score.ts        the rubric — PURE, no I/O
  sheets.ts       append-only writes
  notify.ts       WhatsApp alert + missing-field follow-up
  pipeline.ts     extract → score → append → notify
scripts/
  init-sheet.ts       writes the header row, proves auth works
  read-sheet.ts       dumps current rows
  send-test-webhook.ts fires a signed webhook without Meta or a phone
```

## Setup

```bash
npm install
cp .env.local.example .env.local   # every value is documented in there
npm run sheet:init                 # writes the header row, proves auth works
npm run dev
```

You'll need a Gemini API key, a Google service account with the Sheets API
enabled, and a WhatsApp Cloud API app. `.env.local.example` says where each value
comes from. Two things that cost the most time if missed:

- **Share the Sheet with the service-account email as Editor**, or you get a
  confusing 403.
- **Subscribe your app to the WhatsApp Business Account**, not just to the
  webhook callback URL. These are two different records:

  ```bash
  # app level — the callback URL and fields. Necessary, not sufficient.
  GET /{app-id}/subscriptions

  # account level — which apps this WABA forwards events to. The one that bites.
  GET  /{waba-id}/subscribed_apps
  POST /{waba-id}/subscribed_apps
  ```

  With the first configured and the second missing, everything looks correct in
  the dashboard, Meta's **Test** button delivers fine — it fires from the app
  side and skips account routing — and real messages silently go nowhere.

## Scripts

```bash
npm run dev          # local server
npm test             # 33 unit tests, all on the scoring rubric
npm run sheet:init   # write the Sheet header row
npm run sheet:read   # dump current rows
npm run webhook:test # signed webhook → local or deployed URL, no phone needed
```

`webhook:test` signs with your real app secret, so it exercises the signature
path rather than a dev bypass:

```bash
WEBHOOK_URL=https://your-app.vercel.app/api/webhook/whatsapp \
  npx tsx scripts/send-test-webhook.ts "Need a website, budget 2 lakhs, this month"
```

## Design rules

- **Webhooks return 200 immediately.** Meta retries anything slow or failing, so
  the work happens in `after()`. The form route awaits instead — no platform is
  retrying it, so the visitor gets the real outcome.
- **Every inbound message is deduped** on its `wamid` against a Sheet column.
  Vercel functions are stateless, so the Sheet is the dedupe store.
- **Sheet writes are append-only.** No read-modify-write, no cell updates. This
  sidesteps the concurrency problems in the Sheets API and keeps a full audit
  trail of what the agent saw.
- **Fail loud.** If extraction returns something unparseable, the row is written
  anyway as `Needs Review` with the raw error in its own column. A lead that
  reaches a human beats a lead lost to a swallowed exception.

## Measured, not claimed

- **33/33** unit tests pass on the scoring rubric — band boundaries, all-null
  input, max score, determinism, `score === sum(breakdown)`, and a check that a
  prompt-injection string can't move the score.
- **~7.6s** end-to-end on production for one WhatsApp message: inbound → Gemini →
  score → Sheet row → alert.

Extraction accuracy is **not measured yet** — that needs the fixture set and eval
harness, which is the next thing to build. No number is quoted here until it has
actually been produced by running one.

## Not built yet

- `fixtures/leads.json` + `scripts/eval.ts` — field-level extraction accuracy
- Follow-up receive side: the agent asks the missing-field question today, but
  doesn't yet recognise the reply, merge it and re-score
- Voice-note leads, Telugu support, returning-lead threading by phone number
