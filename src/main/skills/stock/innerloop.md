---
id: analysis.innerloop
name: Inner Loop
description: Sim the plan from the inside — what would actually happen?
menu: Analysis
group: Motivation
outputMode: openConversation
context: [selectedText, fullNote]
model: claude-sonnet-4-6
web: false
firstMessage: "For {{#if selection}}this selection{{else}}this note{{/if}}, sim the inner loop."
longDescription: >-
  Mentally simulates a plan or scenario from the inside, step by step, surfacing the friction
  points the outside view tends to gloss. Output is a step-by-step inner monologue plus the moments
  where the simulation predicts a stumble and the user would course-correct in practice.
  Complements murphyjitsu (failure-mode listing) — innerloop is "play it forward".
---

# innerloop

$ARGUMENTS

**tl;dr**: Ask your gut what it actually expects, then take the answer seriously — especially when it disagrees with your verbal reasoning.

> Core question: "If I imagine this actually happening, what do I *feel* will occur?"

## When to Use

- You've made a plan and something feels off but you can't say what
- Your stated prediction and your felt prediction disagree
- You want to access pattern-matching knowledge that hasn't been verbalized
- Before committing to a decision, as a final check
- When someone says "I think X will happen" but their body language says otherwise

## When NOT to Use

- The domain is genuinely outside your experience (no patterns to match)
- You need precise quantitative estimates (use referenceclass)
- You're in a strong emotional state that would distort simulation (angry, panicked, infatuated)

## Mechanism

1. **Quiet the verbal reasoning** — Stop constructing arguments. Stop optimizing the answer.
2. **Query the simulator** — Imagine the scenario concretely. Watch what your gut expects.
3. **Take the output seriously** — The simulator's answer is evidence, not noise.
4. **Investigate discrepancies** — When gut and verbal disagree, the gap contains information.

## The Surprise-O-Meter

A useful sub-tool: after stating your prediction, ask "If the opposite happened, how surprised would I *actually* be?" Rate from 1 (not surprised at all) to 10 (completely shocked). If you predict X but would only be 3/10 surprised by not-X, your real probability for X is much lower than you're claiming.

## Signature

```
innerloop(scenario_or_plan) → {
  stated_expectation: string,
  simulated_expectation: string,
  surprise_rating: number,  // 1-10
  discrepancy: string | null,
  hidden_knowledge: string[],
  revised_expectation: string
}
```

## Process

### Step 1: State the Official Prediction
Write down what you say you expect, or what your plan assumes will happen. Be specific.

### Step 2: Quiet Verbal Reasoning
Stop arguing for or against the prediction. You're not trying to be right. You're trying to listen.

### Step 3: Simulate Concretely
Imagine the scenario unfolding in detail. Not "the project succeeds" but "it's Tuesday, the deadline is Friday, the code is..." Watch the movie in your head. Note what happens.

### Step 4: Apply the Surprise-O-Meter
Ask: "If this went differently than I predict, how surprised would I *actually* be?" Rate 1-10. If below 7, your real confidence is lower than stated.

### Step 5: Name the Discrepancy
If stated and simulated expectations differ, name the gap precisely. "I say we'll ship on time, but when I imagine Friday, I see us still debugging the integration layer."

### Step 6: Extract Hidden Knowledge
The discrepancy contains information. What does your simulator know that your verbal reasoning hasn't admitted? Common sources: past experience with similar situations, social dynamics you've observed but not articulated, physical intuitions about feasibility.

### Step 7: Revise or Investigate
Either update your prediction to match the simulator (if the simulator's track record is good in this domain) or flag the discrepancy for investigation (if you can't tell which source to trust).

---

See [examples.md](examples.md) for worked examples.
See [reference.md](reference.md) for quality criteria, anti-patterns, and integration points.
{{#if selection}}

## Selection

{{selection | trim}}{{else}}{{#if note.content}}

## Note{{#if note.title}} — {{note.title}}{{/if}}

{{note.content | trim}}{{/if}}{{/if}}
