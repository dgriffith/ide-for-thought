---
id: analysis.goalfactor
name: Goal Factor
description: Decompose a goal into the underlying needs it serves
menu: Analysis
group: Motivation
outputMode: openConversation
context: [selectedText, fullNote]
model: claude-sonnet-4-6
web: false
firstMessage: "For {{#if selection}}this selection{{else}}this note{{/if}}, goal-factor the underlying needs."
longDescription: >-
  Walks a stated goal down to the needs it actually serves — separating the surface action from
  the felt sense of why it matters. Surfaces alternative actions that would meet the same needs
  and helps you notice when a goal is doing more than one job at once. Useful when motivation
  feels misaligned with the stated objective.
---

Apply goalfactor to: $ARGUMENTS

If no action specified, identify the most salient goal or commitment in the current conversation and decompose it.

## tl;dr

**goalfactor** asks: "why do you actually want this?"

It decomposes actions into underlying goals, and those goals into deeper goals, until you find what you're really after.

> "I want X" -> "why?" -> "to get Y" -> "why Y?" -> "because it gives me Z" -> "Z is terminal"

It's a **motivation decomposition operator**.

## when to use

Use **goalfactor** when:

- You're about to spend significant resources on something
- You feel stuck or obligated to a particular path
- Someone (including yourself) is defending an action without clear reasoning
- You want to find **alternative paths** to the same outcome
- You suspect the stated goal is a **proxy** for something else

Don't use when:

- You want to surface hidden objections -> **aversionfactor**
- You want to stress-test a plan -> **murphyjitsu**
- The goal is clearly terminal (e.g., "reduce suffering")

Rule of thumb: **goalfactor = "what would achieving this actually get you?"**

## the mechanism

Most actions serve multiple goals, and most stated goals are instrumental to deeper goals. goalfactor works by:

1. **Vertical decomposition** -- asking "why?" to find deeper goals
2. **Horizontal mapping** -- identifying all the goals served by one action
3. **Alternative generation** -- finding other ways to satisfy the deep goals
4. **Efficiency check** -- is this action the best path to what you actually want?

The insight: people often optimize for proxies while losing sight of what they actually want.

**Terminal vs instrumental:**
- **Terminal goals** = valued for their own sake (connection, autonomy, mastery, meaning, pleasure, security, status)
- **Instrumental goals** = valued because they lead to terminal goals

goalfactor traces instrumental -> terminal chains.

## signature

```
goalfactor(action_or_desire) -> {goal_tree, terminal_goals, alternative_paths, efficiency_assessment}
```

- **action_or_desire:** the thing being examined ("I want to get an MBA")

Output:

- **goal_tree** -- hierarchical map of goals served by this action
- **terminal_goals** -- the bottom-level values being pursued
- **alternative_paths** -- other ways to satisfy the terminal goals
- **efficiency_assessment** -- is the original action a good path?

## process (step by step)

### step 0: state the action or desire
Be specific. "I want to be successful" is too vague. "I want to get promoted to VP by 2025" is workable.

### step 1: ask "why do you want this?"
Generate the immediate goals this action serves. Don't stop at one -- most actions serve multiple goals.

### step 2: recurse on each goal
For each goal from step 1, ask "why do you want that?" Continue until you hit terminal values or the chain starts looping.

### step 3: identify terminal goals
Mark the endpoints. Common terminals: connection, autonomy, mastery, meaning, security, pleasure, status.

### step 4: map the goal tree
Visualize the structure:
```
[action] -> [goal 1] -> [deeper goal] -> [terminal]
         -> [goal 2] -> [terminal]
         -> [goal 3] -> [deeper goal] -> [deeper goal] -> [terminal]
```

### step 5: generate alternative paths
For each terminal goal, brainstorm other ways to achieve it that don't require the original action.

### step 6: assess efficiency
Compare paths: which has the best ratio of terminal goal satisfaction to cost? Does the original action have hidden costs? Are there alternatives that satisfy multiple terminal goals better?

---

See [examples](examples.md) for worked demonstrations.

See [reference](reference.md) for quality criteria, anti-patterns, and integration points.
{{#if selection}}

## Selection

{{selection | trim}}{{else}}{{#if note.content}}

## Note{{#if note.title}} — {{note.title}}{{/if}}

{{note.content | trim}}{{/if}}{{/if}}
