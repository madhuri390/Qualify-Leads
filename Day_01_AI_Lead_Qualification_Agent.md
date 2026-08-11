# Day 1 -- AI Lead Qualification Agent

## Objective

Build an AI automation that automatically qualifies inbound leads from
website forms and WhatsApp enquiries, reducing manual effort and helping
sales teams focus on high-value prospects.
A single Google Sheet stores both web form enquiries and WhatsApp
enquiries. It is the datastore and the dashboard.

The LLM extracts structured facts from free text; code applies the
scoring rubric. The model never returns a score.

---

## Business Problem

Businesses receive leads from multiple channels:

- Website contact forms
- WhatsApp messages
- Email

Every lead is manually reviewed before someone decides whether it is
worth pursuing.

### Current Challenges

- Slow response times
- Unqualified leads consume sales time
- No standardized qualification process
- Leads scattered across different platforms
- High-value leads may be missed

---

## Goal

Create an AI agent that:

1.  Collects new enquiries.
2.  Understands the customer's intent.
3.  Extracts important information.
4.  Scores the lead.
5.  Classifies the lead as Qualified, Follow-up, or Reject.
6.  Saves the result to the Google Sheet.
7.  Notifies the sales team.

---

# Workflow

```text
Website Form / WhatsApp
          │
          ▼
Receive Lead
          │
          ▼
Normalize Data
          │
          ▼
LLM Extraction  (facts only — no score)
          │
          ├── Intent
          ├── Budget
          ├── Timeline
          ├── Services
          ├── Requirement clarity
          ├── Decision maker?
          └── Sentiment
          │
          ▼
Scoring Engine  (pure code, deterministic)
          │
          ├── Qualified   (80-100)
          ├── Follow-up   (50-79)
          └── Reject      (below 50)
          │
          ▼
Append to Sheet + WhatsApp alert to sales
```

---

# Tech Stack

- App: Next.js (App Router) + TypeScript — API routes are the backend
- AI: Gemini free tier, structured output mode
- Datastore: Google Sheet, append-only. No Supabase, no Postgres.
- Messaging: WhatsApp Cloud API — setup completed
- Website Forms: POST to an API route
- Notifications: WhatsApp message back to the sales number
- Hosting: Vercel — needed for a stable webhook URL
- Validation: Zod on every LLM response and webhook payload

Rejected after consideration: Trigger.dev, n8n, Supabase, Slack, email
providers, a separate Node backend.

An admin dashboard is out of scope. The Google Sheet is the dashboard.

---

# Data to Extract

Contact:

- Customer Name
- Company
- Phone Number
- Email

Qualification signals (each one feeds the rubric below):

- Service Interested In
- Budget (amount + currency, `null` if not stated)
- Timeline
- Urgency
- Requirement Clarity — is the ask specific enough to quote?
- Decision Maker — is the sender the one who can approve spend?
- Number of Employees (if applicable)
- Overall Intent
- Sentiment

Every scoring criterion must appear in this list. If the rubric weighs
it, extraction has to produce it.

---

# Lead Scoring Rubric

Applied in code by `lib/score.ts`. Deterministic, no LLM. Max 100.

| Criterion | Points |
|---|---|
| Budget — banded, see below | 0-30 |
| Clear requirement (specific enough to quote) | 20 |
| Urgent timeline (this month / immediate) | 20 |
| Business email (not gmail/yahoo/outlook) | 10 |
| Decision maker (owner, founder, director, "we decided") | 20 |

Budget bands (INR — leads are Indian SMBs, so a flat USD threshold
would score a ₹80k enquiry the same as a ₹40L one):

| Stated budget | Points |
|---|---|
| Not stated | 0 |
| Under ₹50,000 | 5 |
| ₹50,000 - ₹2,00,000 | 15 |
| ₹2,00,000 - ₹10,00,000 | 25 |
| Above ₹10,00,000 | 30 |

Amounts given in USD are converted at a fixed rate held in code — not
fetched live, so scores stay reproducible across runs.

### Bands

- 80-100 → Qualified
- 50-79 → Follow-up
- Below 50 → Reject
- Unparseable extraction → Needs Review (never silently dropped)

---

# Prompt

## System Prompt

You are an experienced B2B sales qualification assistant.

Extract structured facts from incoming enquiries. Report only what the
enquiry actually says — use `null` for anything not stated. Do not
infer, estimate, or fill gaps with plausible values.

Do NOT score, rank, or classify the lead, and do not recommend a next
action. Those are decided downstream in code.

Output conforms to the provided response schema.

---

# Example Input

> Hi, we run a dental clinic with four branches and want an AI chatbot
> for appointment booking and WhatsApp reminders. Our budget is around
> ₹2,50,000 and we'd like to launch this month. I'm the owner.

---

# Example LLM Output (extraction only)

```json
{
  "customer_name": null,
  "company": "Dental Clinic",
  "industry": "Healthcare",
  "phone": null,
  "email": null,
  "service": "AI chatbot for appointment booking and WhatsApp reminders",
  "budget_amount": 250000,
  "budget_currency": "INR",
  "timeline": "This month",
  "urgency": "high",
  "requirement_clarity": "clear",
  "is_decision_maker": true,
  "employee_count": null,
  "intent": "Wants to automate appointment booking across four branches",
  "sentiment": "positive"
}
```

# Example Scored Result (produced by `lib/score.ts`)

```json
{
  "score": 85,
  "breakdown": {
    "budget": 25,
    "clear_requirement": 20,
    "urgent_timeline": 20,
    "business_email": 0,
    "decision_maker": 20
  },
  "status": "Qualified",
  "next_action": "Schedule discovery call"
}
```

`score` must always equal the sum of `breakdown`. Every number is
traceable to a rule — that is the whole reason scoring lives in code.

---

# MVP Checklist

Build in this order. Each item works end-to-end before the next starts.

- [ ] Receive WhatsApp messages (webhook verify + inbound, returns 200 fast)
- [ ] Dedupe on `wamid`
- [ ] Normalize to one Lead shape
- [ ] Gemini extraction with response schema + Zod validation
- [ ] Calculate lead score in `lib/score.ts` (pure, unit tested)
- [ ] Append row to Google Sheet with colour-coded status
- [ ] WhatsApp alert back to the sales number
- [ ] Website form → same pipeline
- [ ] `scripts/eval.ts` — 20 fixtures, prints extraction accuracy

The Google Sheet is the dashboard. A separate UI is a stretch goal.

---

# Stretch Goals

- Auto-reply on WhatsApp asking for the single missing field
- Simple web dashboard
- Multi-language support (Hinglish / Telugu enquiries)
- Meeting scheduling
- CRM integration (HubSpot)

---

# Deliverables

- Working application deployed on Vercel
- GitHub repository
- Architecture diagram
- 60--90 second demo video (Instagram build-in-public)
- README with setup instructions

---

# Success Metrics

Measured, not asserted. Every number below comes from an actual run.

- **Extraction accuracy** — `scripts/eval.ts` runs 20 hand-labelled
  dummy leads through the real pipeline and prints field-level accuracy.
  Target 90%+. This is the headline number for the post.
- **End-to-end latency** — measured and printed, not claimed. Gemini
  Flash makes this ~2-3s, so report the real figure rather than the
  meaningless "under 30 seconds".
- **Score reproducibility** — the same lead scores identically on every
  run. Guaranteed by scoring in code, provable by the unit tests.
- Sales team notified within the same request cycle.
