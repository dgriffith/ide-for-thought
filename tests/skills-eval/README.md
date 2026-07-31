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
    request.json   # the packaged LLM request ("just as Minerva does")
    meta.json      # skill, resolved model, outputMode
```

## Running

```
pnpm cli eval tests/skills-eval/steelman-essential-complexity   # one case
pnpm cli eval --all                                             # every case
```

Each run overwrites the case's `output/`. Review the change with `git diff` (or
IntelliJ's diff) as skills, prompts, models, and the context pipeline evolve.

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
non-deterministic model output (`response.md` / `drafts.json`) is a later,
opt-in addition (PR 2) and is never asserted.
