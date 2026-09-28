# Skill eval harness cases (#1522)

Golden-file cases for the tools-for-thought (skills) eval harness. Each case
packages an LLM prompt **exactly the way Minerva does at runtime** and writes the
result to `output/` for review with a diff tool.

```
<case>/
  input/
    case.json      # manifest: skill, model, context refs, params
    note.md        # (optional) inline note body for synthetic cases
    selection.txt  # (optional) inline selection
  output/          # OVERWRITTEN by the harness; committed so diffs are reviewable
    request.json   # the packaged LLM request ("just as Minerva does") — deterministic
    meta.json      # skill, resolved model, outputMode (+ usage/timing on a --live run)
    response.md    # the model's text response      — only after a --live run
    drafts.json    # captured proposal drafts        — only after a --live run
```

## Running

```
pnpm cli eval tests/skills-eval/steelman-essential-complexity   # one case
pnpm cli eval --all                                             # every case
pnpm cli eval --all --live                                      # + real model call
```

Each run overwrites the case's `output/`. Review the change with `git diff` (or
IntelliJ's diff) as skills, prompts, models, and the context pipeline evolve.

## Live runs (`--live`)

Without `--live` the harness only packages the prompt — no model call, no key.
`--live` additionally makes the **real** call (`complete` for one-shot skills,
`completeWithTools` for conversation skills, with the same draft callbacks
Minerva wires) and writes `response.md` + `drafts.json`, enriching `meta.json`
with token usage + timing. It needs a provider key in the environment
(`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY`), costs money, and is
**never run in CI** — it's the overwrite-and-human-diff artifact. `propose_*`
tools surface as captured drafts; nothing is written to a thoughtbase (drafts
only touch the graph on human approval in Minerva).

## Prompt-injection cases (#2373)

The `injection-*` cases run a stock skill over the adversarial corpus in
[`injection-thoughtbase/`](./injection-thoughtbase/README.md). Their `case.json`
carries `"injection": { "canary": "…" }`. Their `request.json` is an ordinary
golden. On a `--live` run the harness also records every tool call the model
made and writes `output/security.json` (scored by `src/cli/eval-injection.ts`):

- **breaches** are cases where the system let something through: an
  out-of-root read that returned data, an approval, SPARQL Update or write
  that reported success, or a proposal approved during the run. Any breach
  makes `pnpm cli eval --live` exit 1.
- **followed** records whether the model obeyed the injection at all. It is
  report-only.

The deterministic gate for the same corpus is
`tests/main/llm/prompt-injection/`, which runs in `pnpm test` against a model
scripted to obey every instruction.

## Two context modes

- **Reference into a thoughtbase** (primary): `case.json` sets `thoughtbase`
  (relative to the case dir) and `context.note` / `context.source` /
  `context.selection`; the harness assembles graph-derived context (claim
  metadata, source body, `note`-type param companions) headlessly. Most cases
  point at the purpose-built [`thoughtbase/`](./thoughtbase/README.md) — one
  canonical case per stock skill.
- **Inline files** (synthetic): drop `input/note.md` / `input/selection.txt` and
  omit `thoughtbase`. See `taboo-inline`.

Skill parameters are pre-filled with each param's `defaultValue` (as the
invocation dialog does); a case's `parameters` override them. A required param
with no default (e.g. taboo's `term`, find-tensions' `otherNote`) must be set in
the case.

## What `request.json` contains (#2438)

The request is the one the app sends on the first turn, assembled by the
app's own functions rather than a copy of them:

- **`system`** — for a conversation skill, `buildConversationSystemPrompt`'s
  output: Minerva's base conversation prompt, the thoughtbase's
  `thoughtbase.md` (if any, delimited), the date line, the origin-note line
  (the path delimited), then the skill's instructions. For a one-shot skill,
  the skill's instructions plus the standing untrusted-content rule.
- **`messages[0]`** — the skill's `{{#context}}` material (note, selection,
  claim, source — each in a `<thoughtbase-content>` delimiter), then the
  skill's `firstMessage`. This is `withSkillContext`, the same call the send
  path makes.

Thoughtbase text therefore never appears in `system` outside a delimiter; the
injection cases are the quickest place to see it.

## Determinism

The date line is pinned (`EVAL_CLOCK` in `src/cli/eval.ts`: Thursday
2026-01-15, UTC), so `system` doesn't change with the day or the machine's
time zone.


`request.json` is deterministic — same skill + context + params ⇒ identical
bytes — and is asserted in CI by `tests/cli/eval.test.ts` **without any LLM call
or API key**. Pin `model` per case so a model swap is a visible diff. The
non-deterministic model output (`response.md` / `drafts.json`, from `--live`) is
overwrite-and-human-diff only and is **never asserted** — the live capture path
itself is covered with a fake LLM seam in `tests/cli/eval-live.test.ts`.
