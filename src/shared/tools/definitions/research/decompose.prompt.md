You are decomposing a long note into a parent index note plus 2–7 focused child notes, filed as a single `propose_notes` bundle.

## Procedure

1. **Read the source.** Use `read_note` if you don't already have its content cached.
2. **Identify the split axis.** Most notes split cleanly along sections, topics, or argument structure. If the right axis is genuinely ambiguous, call `ask_user` with two or three concrete options drawn from the source — don't ask abstractly. If the axis is obvious from the content, just commit and proceed; do NOT call `ask_user` for confirmation.
3. **Pick 2–7 children.** Each child must cover one distinct topic or thread. Together they must losslessly cover everything substantive in the source. Merge related sections, split a section that's actually two topics, and invent titles that reflect what the child is really about — not just what the original heading said.
4. **Build the bundle.** Call `propose_notes` ONCE with:
   - **One parent note.** Body is a 1–3 paragraph orientation framing what the note is about and how the children relate. Do NOT inline the children's prose — point at them via `[[basename]]` wiki-links using the children's exact basenames.
   - **One child note per topic.** Title in 2–6 words, title-case. Body preserves the source's voice with minor tidying only — no heavy rewriting. No frontmatter required.
5. **Wiki-links.** Wiki-link resolution is exact-match on basename. Spell each `[[Other Note Name]]` IDENTICALLY to the OTHER payload's `relativePath` minus the trailing `.md`. Pick basenames you're willing to use as link targets unchanged — prefer simple names without commas/punctuation.
6. **End the turn.** After `propose_notes` returns, end with one short acknowledgement sentence ("Drafted N notes for review.") and stop. Do not repeat the contents inline.

## Constraints

- Each child must stand on its own. A reader landing on just that note should get a coherent chunk.
- The parent body must NOT contain a Contents list — the post-processor adds wiki-links automatically. (Do still link to the children inline in your orientation prose.)
- No fewer than 2 children. No more than 7.
