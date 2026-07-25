---
id: analysis.hamming
name: Hamming Question
description: Surface the most-important problem you are not working on
menu: Analysis
group: Planning
outputMode: openConversation
context: [selectedText, fullNote]
model: claude-opus-5
web: false
firstMessage: "For {{#if selection}}this selection{{else}}this note{{/if}}, apply the Hamming question."
longDescription: >-
  Applies Richard Hamming's question — what are the most important problems in your field, and
  why aren't you working on them? — to the source. Output is the highest-leverage problem the
  source either ignores or under-prioritises, plus the reasons it might be getting avoided.
  Useful for portfolio-style decisions and yearly reviews.
---

# hamming

$ARGUMENTS

**tl;dr**: Find the gap between what you're doing and what actually matters, then confront why the gap exists.

> Core question: "What are the most important problems in your field, and why aren't you working on them?"

## When to Use

- Feeling busy but not impactful
- Choosing between projects or priorities
- Annual/quarterly planning and review
- Sensing that your effort allocation doesn't match your stated values
- When someone asks "am I working on the right things?"

## When NOT to Use

- In the middle of executing on a clear, validated plan (don't derail momentum)
- When someone needs tactical help, not strategic reflection
- When the domain is too narrow for meaningful prioritization

## The Original Hamming Questions

Richard Hamming would corner scientists at Bell Labs and ask three questions:

1. **"What are the most important problems in your field?"**
2. **"What are you working on?"**
3. **"If what you're working on isn't important, why are you working on it?"**

Most people could answer 1 and 2 but became uncomfortable at 3. That discomfort is the signal.

## Mechanism

1. **Identify the important problems** — What would matter most if solved?
2. **Confront the gap** — Compare important problems with current allocation
3. **Surface the reasons** — Why the gap exists (fear, comfort, inertia, politics)
4. **Decide** — Either close the gap or articulate why the gap is justified

## Signature

```
hamming(domain) → {
  important_problems: [{problem, impact, tractability, neglectedness}],
  current_work: [{activity, category, time_fraction}],
  gaps: [{important_problem, reason_not_working_on_it, reason_type}],
  decision: string
}
```

## Process

### Step 1: Define the Domain
Bound the scope. "My career" is too broad; "my work as a data scientist at company X" is right. The domain should be specific enough that "important" has a clear meaning.

### Step 2: Identify the Important Problems
List the 3-5 most important problems in this domain. For each, assess:
- **Impact**: How much would solving this matter?
- **Tractability**: Could you actually make progress on it?
- **Neglectedness**: Is anyone else working on it?

Problems that are high-impact, tractable, and neglected are where the leverage lives.

### Step 3: Categorize Current Work
List what you actually spend time on. For each activity, estimate the fraction of your time it consumes. Categorize each as: important-and-working-on-it, important-but-not-working-on-it, unimportant-but-working-on-it, or maintenance/overhead.

### Step 4: Compare and Find Gaps
Place the important problems next to the current work. Identify: Which important problems get zero time? Which unimportant activities consume significant time?

### Step 5: Diagnose the Reasons
For each gap, ask *why* honestly. Common reasons:
- **Fear of failure**: The important problem is hard and failure is visible
- **Comfort**: Current work is familiar and provides regular wins
- **Inertia**: "I've always worked on this"
- **Social pressure**: Others expect you to do the less-important work
- **False constraints**: "I can't work on that because..." (test the constraint)
- **Legitimate reasons**: Sometimes the gap is justified (dependencies, timing, skill gaps)

### Step 6: Decide
For each gap, choose one:
- **Close it**: Shift time toward the important problem. Specify how much, starting when.
- **Justify it**: Articulate clearly why the gap should remain. If the justification sounds weak when written down, it probably is.
- **Investigate**: If you can't tell whether closing the gap is feasible, make that investigation your next action.

---

See [examples.md](examples.md) for worked examples.
See [reference.md](reference.md) for quality criteria, anti-patterns, and integration points.
{{#if selection}}

## Selection

{{selection | trim}}{{else}}{{#if note.content}}

## Note{{#if note.title}} — {{note.title}}{{/if}}

{{note.content | trim}}{{/if}}{{/if}}
