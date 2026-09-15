# Day 10 — Script

75-day build challenge. ~75-90s, build-in-public style, matches the Day 1 "shot" brief:
phone/screen footage over voiceover, honest about what's real vs. still manual.

---

## Hook (0–5s)

**Visual:** Phone screen — a lead form getting filled out and submitted.
**VO:**
> "A stranger fills out a form on my site. Ten seconds later, I know if they're worth calling."

---

## Beat 1 — The problem (5–15s)

**Visual:** Split screen — inbox full of unread leads / a messy spreadsheet.
**VO:**
> "Day 1 of this challenge, I built an agent that reads a lead, scores it, and puts it in a
> sheet. That part's been running since. But scoring a lead isn't the same as knowing
> anything about the business behind it."

---

## Beat 2 — What's new (15–40s)

**Visual:** Screen recording — dashboard loading, stat tiles counting up, a lead row.
**VO:**
> "So I built the next step. Every qualified lead now shows up on a dashboard — not just
> the score, the actual pipeline: pending, approved, scheduling, call scheduled."

**Visual:** Click a row → drawer slides open showing the business analysis.
**VO:**
> "One click, and the agent goes and finds the business — Google reviews, their own
> website, what they actually do — and writes a real briefing. Not a guess. A summary
> built from what it found."

**Visual:** Approve button → WhatsApp message appearing on phone.
**VO:**
> "Approve it, and it sends the lead a message on WhatsApp with a link to book a call —
> already knowing what their business does before I've said a word."

---

## Beat 3 — The honest part (40–55s)

**Visual:** Quick cut — a "Reject" button, an error message, a retry.
**VO:**
> "Also — build in public means showing the parts that broke. I burned through a free
> AI quota mid-build, switched providers twice, and spent an hour chasing a WhatsApp bug
> that turned out to be one wrong secret key. That's most of the actual work."

---

## Payoff shot (55–70s)

**Visual:** Full loop, sped up — form submit → dashboard → approve → phone buzzes with
the WhatsApp message, Calendly link visible.
**VO:**
> "Lead comes in. Gets scored. Gets researched. Gets a message with a plan to talk —
> before I've touched it once."

---

## Close (70–80s)

**Visual:** Static end card — dashboard, stat tiles visible.
**VO:**
> "Day 10 of 75. Next: [whatever's next]."

**On-screen text:** `Day 10/75 — Lead qualification, now with a brain.`

---

## Notes for the edit

- Don't claim an accuracy or latency number on camera unless `scripts/eval.ts` has actually
  been run against the current model and you're reading the real printed number — this
  project's own rule, and it held up in this session (Gemini's real latency varied a lot,
  2s to 47s, worth mentioning as a real tradeoff rather than hiding it).
- The WhatsApp message only sends if the lead's number has an open 24h session — true
  limitation, fine to mention if asked in comments, not necessary in the video itself.
- If including the "broke and fixed it" beat feels like too much for 75-90s, it's the first
  thing to cut — the payoff shot carries the video on its own.
