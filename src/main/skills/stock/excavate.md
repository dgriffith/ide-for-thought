---
id: analysis.excavate
name: Excavate
description: Surface hidden assumptions underlying arguments
menu: Analysis
group: Diagnostic
outputMode: newNote
outputNotePrefix: excavate
slashCommand: /excavate
context: [selectedText, fullNote]
longDescription: >-
  Assumption archaeology that maps the hidden assumptions supporting a claim, belief, or plan.
  Unlike opposition-generation, Excavate surfaces the "skeleton" beneath a stance by repeatedly
  asking "what must be true for this to make sense?" until reaching axioms or maximum depth.
parameters:
  - id: depth
    label: Analysis depth
    type: select
    default: |-
      Perform a **standard** excavation:
      - Generate layer-1 assumptions (3-7 items)
      - Recurse downward for 2-3 levels, tagging with [CRUX], [HIGH-UNCERTAINTY], [HIGH-LEVERAGE]
      - Categorize each assumption: Empirical, Normative, Structural, Psychological, or Definitional
      - Summarize the 3-7 load-bearing cruxes
      - Generate probe questions for each crux
    options:
      - label: "Quick — surface assumptions only"
        value: |-
          Perform a **quick** excavation:
          - Generate layer-1 assumptions only (3-7 items answering "what must be true?")
          - Tag each as [CRUX], [HIGH-UNCERTAINTY], or [HIGH-LEVERAGE] where applicable
          - Summarize the top 3 load-bearing cruxes
          - Generate 2-3 probe questions
      - label: "Standard — assumptions + implications"
        value: |-
          Perform a **standard** excavation:
          - Generate layer-1 assumptions (3-7 items)
          - Recurse downward for 2-3 levels, tagging with [CRUX], [HIGH-UNCERTAINTY], [HIGH-LEVERAGE]
          - Categorize each assumption: Empirical, Normative, Structural, Psychological, or Definitional
          - Summarize the 3-7 load-bearing cruxes
          - Generate probe questions for each crux
      - label: "Deep — assumptions + implications + genealogy"
        value: |-
          Perform a **deep** excavation:
          - Generate layer-1 assumptions (5-7 items)
          - Recurse downward for 3-4 levels, tagging with [CRUX], [HIGH-UNCERTAINTY], [HIGH-LEVERAGE]
          - Categorize each: Empirical, Normative, Structural, Psychological, or Definitional
          - Trace the genealogy of key assumptions — where do they come from? What traditions or experiences produced them?
          - Summarize the 3-7 load-bearing cruxes
          - Generate probe questions for each crux
          - Identify which cruxes are empirically testable vs. value-based
---
You are performing an Excavate analysis — assumption archaeology. Your goal is to map the hidden assumptions supporting the claim, belief, or plan presented below. The core question is: **"What must be true for this to make sense?"**

## Assumption Categories

Tag each assumption with its type:
1. **Empirical** — factual claims about the world
2. **Normative** — value judgments and priorities
3. **Structural** — incentives, institutions, competitive dynamics
4. **Psychological** — cognition, motivation, perception
5. **Definitional** — category boundaries and meaning

## Instructions

**Step 1 — Normalize** the claim into a crisp, single statement.

{{param.depth}}

## Expected Output

Produce three artifacts:

1. **Layered assumption tree** — clean, non-redundant branches with category tags and importance markers
2. **Crux list** — the 3-7 highest-impact assumptions that, if wrong, would most undermine the position
3. **Probe questions** — concrete, testable or investigable questions that would update the cruxes

## Key Principle

The goal isn't judgment — it's mapping where effort and evidence should focus next. You are not arguing for or against the position; you are excavating its foundations.

## {{#if selection}}Selected Text{{else}}Note{{/if}}

{{#if selection}}{{selection}}{{else}}{{note.content}}{{/if}}

Respond in markdown. Use indented lists or tree notation for the assumption layers. Bold the [CRUX] items. End with the probe questions as a numbered list.
