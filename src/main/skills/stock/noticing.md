---
id: analysis.noticing
name: Noticing
description: Surface the felt sense the prose isn't saying out loud
menu: Analysis
group: Pattern
outputMode: openConversation
context: [selectedText, fullNote]
model: claude-sonnet-5
web: false
firstMessage: "For {{#if selection}}this selection{{else}}this note{{/if}}, name what is being noticed."
longDescription: >-
  Reads the source for the things the writer is sensing but not yet articulating — confusion,
  disagreement, hesitation, excitement, surprise. Output names each noticed felt sense, points
  at the textual evidence for it, and asks one or two questions that would make the noticed
  thing legible. Useful when prose feels like it's circling something it can't quite say.
---

# noticing

$ARGUMENTS

**tl;dr**: Catch the flicker of "wait, something's off" before your brain smooths it over, and flag it for investigation.

> Core question: "What am I glossing over right now?"

## When to Use

- Something feels slightly wrong but you can't articulate what
- You're about to move past a question without answering it
- A conversation shifted topics and you're not sure why
- You feel a twinge of discomfort that's easy to ignore
- You realize you've been avoiding thinking about something
- Someone mentions ugh fields, flinching, or "glossing over"

## When NOT to Use

- You already know the problem and need a solution (use a different skill)
- In high-urgency situations requiring immediate action (notice later, act now)
- When noticing becomes recursive avoidance of doing the actual work

## Mechanism

Your brain smooths over inconsistencies, discomfort, and confusion in milliseconds. By the time you're aware of a thought, the rough edges have been filed down and the threatening implications have been tucked away. Noticing is the skill of catching **step 1** — the raw signal before the smoothing.

The signal is always brief: a flicker of confusion, a moment of "huh," a flinch away from a thought. If you don't catch it in the moment, your brain rewrites history to say it never happened.

## What to Notice

### Epistemic Signals
- Confusion you're about to wave away: "I don't quite get that, but it's probably fine"
- Inconsistency between two things you believe
- An argument that's persuasive but you can't reconstruct the reasoning
- Something being explained in suspiciously vague language

### Emotional Signals
- A flinch away from a topic (ugh field)
- Relief when a subject changes
- Defensiveness that arrives before a threat
- Feeling "this is fine" in a way that protests too much

### Social Signals
- A topic the group silently agreed not to discuss
- Someone's tone not matching their words
- Your own urge to perform agreement you don't feel
- The moment you decide not to ask the obvious question

### Process Signals
- Skipping a step and hoping it won't matter
- Choosing the easy task over the important one
- Rationalizing a decision you made for other reasons
- Planning to do something you know you won't do

## Signature

```
noticing(situation) → {
  signals_detected: [{signal, type, raw_content}],
  smoothing_attempts: string[],
  flags_for_investigation: string[],
  recommended_tool: string | null
}
```

## Process

### Step 1: Build Meta-Attention
Before examining the situation, shift into observer mode. You're not trying to solve anything. You're trying to see what's there — especially what's trying to not be seen.

### Step 2: Catch the Flicker
Scan the situation for the four signal types: epistemic, emotional, social, process. For each, ask: "Is there a signal here that I'm about to ignore?" The question itself often surfaces the signal.

### Step 3: Name It
Give the signal a precise name. Not "something feels off" but "I notice I feel relief when the conversation moves away from the budget question." Naming it prevents your brain from re-smoothing it.

### Step 4: Resist the First Explanation
Your brain will immediately offer a comfortable explanation for the signal. "I'm relieved because the budget question is boring." Maybe. But the first explanation is often a cover story. Hold it at arm's length. Don't accept or reject it — just notice that it arrived very quickly.

### Step 5: Investigate or Flag
Either investigate now (using the appropriate skill — innerloop for predictions, aversionfactor for flinches, doublecrux for disagreements) or explicitly flag it for later. "I notice I'm avoiding thinking about the budget. I'm flagging this for investigation tomorrow." Flagging is acceptable; pretending you didn't notice is not.

---

See [examples.md](examples.md) for worked examples.
See [reference.md](reference.md) for quality criteria, anti-patterns, and integration points.
{{#if selection}}

## Selection

{{selection | trim}}{{else}}{{#if note.content}}

## Note{{#if note.title}} — {{note.title}}{{/if}}

{{note.content | trim}}{{/if}}{{/if}}
