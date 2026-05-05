
Apply doublecrux to: $ARGUMENTS

If no positions are specified, identify the most significant disagreement or tension in the current conversation and find the crux.

## tl;dr

Find the belief that would change the conclusion if flipped. Disagreement resolution operator.

> "what's the one thing that, if you learned you were wrong about it, would make you change your mind?"

## when to use

Use when:
- Two parties hold **opposing positions** and neither is moving
- An argument is **generating heat but not light**
- You want to find out if a disagreement is **resolvable in principle**
- You need to identify what **evidence would actually matter**
- You're trying to understand **why you believe something**

Don't use when:
- The disagreement is purely semantic -- use **taboo**
- You need to surface hidden assumptions -- use **excavate**
- There's no genuine disagreement to resolve

## the mechanism

Most arguments are about conclusions, not reasons. People defend positions without examining what's actually holding them up. Doublecrux reverses this:

1. **Identifying cruxes** -- beliefs that are necessary for the conclusion
2. **Checking for shared cruxes** -- finding where both parties' conclusions depend on the same belief
3. **Targeting the crux** -- investigating that specific claim rather than the whole debate

The insight: if you find a crux that both parties agree would change their minds, you've transformed an argument into an investigation.

**Double** crux means: the crux must be load-bearing for *both* sides. A believes X, B believes not-X. If both would flip their conclusion upon learning the truth about claim C, then C is the double crux.

## signature

`doublecrux(position_A, position_B) -> {cruxes_A, cruxes_B, double_cruxes, investigation_plan}`

- **position_A:** first party's conclusion and reasoning
- **position_B:** second party's conclusion and reasoning

Output:
- **cruxes_A** -- beliefs that A would need to change to flip
- **cruxes_B** -- beliefs that B would need to change to flip
- **double_cruxes** -- cruxes shared by both (the investigation targets)
- **investigation_plan** -- how to resolve the double crux empirically or logically

## process

### step 0: clarify the disagreement
State both positions clearly. Ensure you're disagreeing about the same thing (use **taboo** if needed).

### step 1: generate cruxes for A
Ask A: "List the beliefs that, if you learned they were false, would make you change your conclusion."

For each belief, verify:
- Is it actually necessary? (If this were false, would you really change your mind?)
- Is it specific enough to test or investigate?

Aim for 3-7 genuine cruxes.

### step 2: generate cruxes for B
Repeat for B. Same verification process.

### step 3: identify double cruxes
Compare the lists. Look for:
- **Direct overlaps** -- same belief on both lists
- **Inverse pairs** -- A's crux is "X is true," B's crux is "X is false"
- **Upstream connections** -- both cruxes depend on a shared third belief

A double crux is a belief where:
- If A learned it was false, A would move toward B's position
- If B learned it was true, B would move toward A's position

### step 4: verify the double crux
Ask both parties:
- "If we discovered that [double crux] was actually [true/false], would you change your conclusion?"
- "Is there anything else you'd need, or is this the crux?"

If either says "no, I'd still believe my conclusion," it's not a real crux. Go back to step 1.

### step 5: design the investigation
For the verified double crux:
- What evidence would resolve it?
- What experiment, analysis, or research would help?
- What would each outcome mean for the original disagreement?

### step 6: investigate or acknowledge limits
Either:
- Pursue the investigation and update based on findings
- Acknowledge that the crux is currently unresolvable (and the disagreement is therefore rational)

## additional resources

- For worked examples, see [examples.md](examples.md)
- For quality criteria, anti-patterns, and integration points, see [reference.md](reference.md)
