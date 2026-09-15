# Fixtures

Hand-written enquiries with hand-written expected extractions. `scripts/eval.ts`
runs each `message` through the real pipeline and compares against `expected`.

Nothing here is scraped or real. They exist to measure extraction, not to
simulate a market.

## Shape

```jsonc
{
  "id": "hinglish-restaurant-chatbot",   // stable, kebab-case
  "language": "hinglish",                // english | hinglish | tenglish
  "note": "what this case is testing",
  "message": "the enquiry exactly as it would arrive",
  "expected": { /* the ten asserted fields */ },
  "expected_score": 85,                  // derived from expected via score.ts
  "expected_status": "Qualified"
}
```

## What `expected` asserts, and what it doesn't

Ten fields are asserted: `customer_name`, `company`, `email`, `service`,
`budget_amount`, `budget_currency`, `timeline`, `urgency`,
`requirement_clarity`, `is_decision_maker`.

`industry`, `phone`, `employee_count`, `intent` and `sentiment` are deliberately
left out. None feed the rubric, and all five are judgement calls that would add
noise to the accuracy number without telling us anything about qualification.

**Nulls are assertions, not omissions.** `"budget_amount": null` means the model
must return null. Those cases are the hallucination check — the prompt says a
wrong guess is worse than a null, and this is where that gets measured.

## Matching rules for `scripts/eval.ts`

- `budget_amount`, `budget_currency`, `urgency`, `requirement_clarity`,
  `is_decision_maker` — **exact**. These drive the score, so a near miss is a
  miss.
- `service`, `timeline`, `customer_name`, `company` — **fuzzy**, case-insensitive.
  These are free text; the schema asks for the sender's phrasing while the prompt
  asks for English, so "this month" and "This month" and "in this month" are all
  correct. Scoring them strictly would understate accuracy badly and teach us
  nothing.
- Report accuracy **per field**, not per fixture. One number for the whole
  fixture hides which field is weak, and the field that matters most is budget.

## Open contract questions these fixtures surfaced

Three things the system prompt doesn't currently rule on. Worth deciding before
the accuracy number gets quoted anywhere, since each one makes a fixture
arguable rather than wrong:

1. **Budget ranges.** "40-50 hazaar" — lower bound, upper, or midpoint? No
   fixture here uses a range, precisely because the answer is undefined. Add a
   rule, then add the fixture.
2. **"Next month" urgency.** The prompt covers this month (high) and next
   quarter (medium), but not next month. `hinglish-not-decision-maker` assumes
   medium.
3. **Explicit non-decision-makers.** The prompt says an unsigned enquiry is
   `null`, not `false`, but says nothing about a sender who names someone else as
   the approver. `hinglish-not-decision-maker` and `tenglish-code-mixed-not-dm`
   both assume `false`, which is the reading the schema's "Only true when the
   text actually says so" supports — but it isn't stated.

## Coverage

| Language | Qualified | Follow-up | Reject |
|---|---|---|---|
| Hinglish | 2 | 0 | 3 |
| Tenglish | 1 | 3 | 1 |

Still missing before this is the full set: English fixtures, prompt-injection
cases, spam, and one-word enquiries.
