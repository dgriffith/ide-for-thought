---
id: analysis.aversionfactor
name: Aversion Factor
description: Decompose a stated objection into the underlying aversions
menu: Analysis
outputMode: openConversation
context: [selectedText, fullNote]
model: claude-sonnet-4-6
web: false
firstMessage: "For {{#if selection}}this selection{{else}}this note{{/if}}, aversion-factor the underlying objection."
longDescription: >-
  Inverse of goal-factor: takes a stated objection or hesitation and walks it down to the actual
  aversions driving it. Output names the aversion crisply, identifies which actions would actually
  address it (vs. accommodate it), and flags when a stated reason is doing motivated cover for a
  different felt sense.
---

Apply aversionfactor to: $ARGUMENTS

If no objection specified, identify the most salient stuck point or resistance pattern in the current conversation.

## tl;dr

**aversionfactor** asks: "what's the real objection hiding beneath the stated one?"

It surfaces hidden resistance by repeatedly asking "and if that weren't true, would you do it?"

> stated: "I don't have time"
> real: "I'm afraid I'll fail and that would be humiliating"

It's a **resistance decomposition operator**.

## when to use

Use **aversionfactor** when:

- Someone (including yourself) keeps **not doing** something they claim to want
- Objections seem to **shift** when addressed ("okay, but also...")
- The stated reason feels like a **rationalization**
- You've solved the practical problems but action still doesn't happen
- There's an **ugh field** around a topic -- a felt sense of "I don't want to think about this"

Don't use when:

- The stated objection is genuine and sufficient -> just solve it
- You're exploring goals, not resistance -> **goalfactor**
- You want to surface assumptions -> **excavate**

Rule of thumb: **aversionfactor = "if that problem were magically solved, would you do it? no? then what's the real reason?"**

## the mechanism

Stated objections are often not the real objections. The real objections are:

1. **Too threatening to voice** -- "I'm afraid of failing" is harder to say than "I'm too busy"
2. **Not consciously accessible** -- the person genuinely doesn't know what's blocking them
3. **Multiply determined** -- several aversions stack up, but only one gets verbalized

aversionfactor works by:

1. **The magic wand test** -- "if [stated objection] were magically solved, would you do it?"
2. **Iterative peeling** -- each "no" reveals another layer
3. **Aversion taxonomy** -- categorizing what type of resistance this is
4. **Direct addressing** -- engaging with the real aversion, not the proxy

The insight: most procrastination and "stuck" patterns are protection against something. Finding what's being protected reveals what's actually going on.

## signature

```
aversionfactor(stated_objection, desired_action) -> {aversion_stack, root_aversion, aversion_type, resolution_paths}
```

- **stated_objection:** the surface-level reason given ("I don't have time")
- **desired_action:** what they're not doing but claim to want

Output:

- **aversion_stack** -- layers of objection from surface to root
- **root_aversion** -- the deepest resistance
- **aversion_type** -- category of the root aversion
- **resolution_paths** -- ways to address or work around the real aversion

## process (step by step)

### step 0: identify the pattern
Notice: what action is not happening despite stated intention? What reason is given?

### step 1: apply the magic wand test
"Imagine [stated objection] were completely solved -- you had infinite time/money/skill/whatever. Would you do it then?"

- If **yes** -> the stated objection might be genuine; help solve it
- If **hesitation or no** -> there's a deeper aversion; continue

### step 2: surface the next objection
"So if time weren't the issue, what would still make this hard?"

Capture the new objection. Don't judge it.

### step 3: iterate the magic wand
Repeat steps 1-2 on the new objection. Continue until:
- You hit something that feels like the real resistance
- The person says "yeah, if that were solved, I'd actually do it"

### step 4: classify the root aversion
What type of resistance is this? (See aversion taxonomy in reference.md)

### step 5: validate the aversion
The aversion exists for a reason. Acknowledge it:
- "It makes sense that you'd be afraid of [X]"
- "That's a real risk/cost you're protecting against"

Validation isn't agreement -- it's recognition that the aversion is doing something.

### step 6: explore resolution paths
Now that the real aversion is visible:
- Can it be addressed directly?
- Can the action be modified to reduce the aversion?
- Can the aversion be accepted and acted through anyway?
- Is the aversion revealing that you don't actually want the thing?

---

See [examples](examples.md) for worked demonstrations.

See [reference](reference.md) for aversion taxonomy, quality criteria, anti-patterns, and integration points.
{{#if selection}}

## Selection

{{selection | trim}}{{else}}{{#if note.content}}

## Note{{#if note.title}} — {{note.title}}{{/if}}

{{note.content | trim}}{{/if}}{{/if}}
