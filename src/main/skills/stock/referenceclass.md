---
id: analysis.referenceclass
name: Reference Class
description: Forecast via base rates from the right outside view
menu: Analysis
outputMode: openConversation
context: [selectedText, fullNote]
model: claude-sonnet-4-6
web: true
firstMessage: "For {{#if selection}}this selection{{else}}this note{{/if}}, find the reference class."
longDescription: >-
  Forces an outside view: pick a reference class of similar past situations, surface their base
  rate, then check whether the current case has any features that should move the estimate off
  that rate. Reach for this when an estimate or prediction is in the air and "this time is
  different" thinking is doing more work than the inside view warrants.
---

# referenceclass

$ARGUMENTS

**tl;dr**: Before reasoning about why *this case* is different, find out what usually happens in cases like this.

> Core question: "What's the base rate for things like this?"

## When to Use

- Making predictions or probability estimates
- Estimating project timelines or budgets
- Assessing likelihood of success for a venture
- Any time you catch yourself thinking "but this time is different"
- When you need to sanity-check an inside-view estimate

## When NOT to Use

- The situation is genuinely unprecedented (no reference class exists)
- You need a causal model, not just a prediction
- The reference class is so broad it carries no information

## Inside View vs Outside View

The **inside view** builds a model from the specifics of the situation: the team, the plan, the details. It asks "how will this unfold?" The **outside view** ignores the specifics and asks "what usually happens when people attempt things like this?" The inside view is seductive because it feels like real reasoning. The outside view is boring but calibrated. Referenceclass forces you to start from the outside view before allowing inside-view adjustments.

## Mechanism

1. **Identify the reference class** — What category does this belong to?
2. **Find base rates** — What actually happens to things in that category?
3. **Anchor on the base rate** — Start your estimate there, not from your model
4. **Adjust cautiously** — Only move away from the base rate with strong, specific evidence

## Signature

```
referenceclass(prediction_or_estimate) → {
  reference_class: string,
  base_rate: number | range,
  inside_view_estimate: number,
  adjustment_reasons: string[],
  final_estimate: number | range,
  confidence: string
}
```

## Process

### Step 1: State the Inside-View Estimate
Write down your current prediction or estimate before looking at base rates. This is your anchor to compare against.

### Step 2: Identify Candidate Reference Classes
Generate at least 3 plausible reference classes at different levels of specificity. Too broad is uninformative; too narrow cherry-picks.

### Step 3: Select the Best Reference Class
Choose the class that is specific enough to be informative but broad enough to have sufficient data. State why you chose it.

### Step 4: Find the Base Rate
Look up or estimate actual outcomes for the reference class. Use real data when available. Note sample size and data quality.

### Step 5: Compare Inside View to Base Rate
Place your inside-view estimate and the base rate side by side. Note the gap. The gap is the territory you need to explain.

### Step 6: Identify Legitimate Adjustment Factors
List specific, verifiable reasons this case differs from the reference class. Each reason must shift the estimate in a stated direction by a stated amount. Be suspicious of adjustments that all go the same way.

### Step 7: Produce Final Estimate
Start from the base rate. Apply adjustments. The final estimate should be closer to the base rate than your original inside-view estimate in almost all cases. If it isn't, explain why with extreme clarity.

---

See [examples.md](examples.md) for worked examples.
See [reference.md](reference.md) for quality criteria, anti-patterns, and integration points.
{{#if selection}}

## Selection

{{selection | trim}}{{else}}{{#if note.content}}

## Note{{#if note.title}} — {{note.title}}{{/if}}

{{note.content | trim}}{{/if}}{{/if}}
