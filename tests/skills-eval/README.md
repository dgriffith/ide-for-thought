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

## Two context modes

- **Reference into a thoughtbase** (primary): `case.json` sets `thoughtbase`
  (relative to the case dir) and `context.note` / `context.source`; the harness
  assembles graph-derived context (relatedNotes, taggedNotes, claim metadata,
  source) headlessly. See `steelman-essential-complexity`.
- **Inline files** (synthetic): drop `input/note.md` / `input/selection.txt` and
  omit `thoughtbase`. See `taboo-inline`.

## Determinism

`request.json` is deterministic — same skill + context + params ⇒ identical
bytes — and is asserted in CI by `tests/cli/eval.test.ts` **without any LLM call
or API key**. Pin `model` per case so a model swap is a visible diff. The
non-deterministic model output (`response.md` / `drafts.json`, from `--live`) is
overwrite-and-human-diff only and is **never asserted** — the live capture path
itself is covered with a fake LLM seam in `tests/cli/eval-live.test.ts`.
