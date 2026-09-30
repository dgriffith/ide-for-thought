Closes #

## What and why

<!-- What changed, and why. The commit subject says what; this says why. -->

## Testing

<!-- What you ran, and for UI changes what you checked by hand. -->

## Checklist

- [ ] `pnpm lint` and `pnpm test` pass; updated snapshots are included
- [ ] Touches the renderer UI for proposals or drafts (`ProposalsPanel.svelte`, `*DraftCard.svelte`, the proposal/draft stores) → a component test under `tests/renderer/components/` is added or updated
- [ ] Touches an LLM or graph write path → went through CLAUDE.md's *Code Review Checklist for LLM/Graph PRs*
- [ ] A fix (`fix:`) → the issue it closes is labelled `bug`, or this PR is if there is no issue (see `docs/development.md` → *Pull requests*)
