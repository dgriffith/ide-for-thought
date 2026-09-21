/**
 * Authoring the note body for a mined `thought:Claim` (#104), moved out of the
 * IPC registrar in #2237 (epic #2241).
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * This function decides how a claim is REPRESENTED in the thoughtbase, and the
 * graph layer has to agree with it. In #2036 the representation changed — from
 * an embedded `a thought:Claim` turtle block to `type: claim` frontmatter,
 * which asserts `a types:Claim` and lands the title as `dc:title` — and every
 * health-check query still asked for `a thought:Claim` with a `thought:label`.
 * They matched nothing. The inspections panel reported "no unsupported claims"
 * on thoughtbases full of them, which is a wrong answer rather than a missing
 * feature, and nobody noticed.
 *
 * #2230 fixed the query side (`graph/argument-patterns.ts` now asks via
 * `rdf:type/rdfs:subClassOf*` and falls back to `dc:title`). This is the other
 * half: the authoring side was buried 51 lines into a 608-line IPC registrar,
 * so a reviewer looking at the graph layer had no reason to open the file where
 * the shape is actually decided.
 *
 * What keeps the two halves honest is now executable rather than a comment:
 * `tests/main/graph/health-checks.test.ts` calls THIS function to author its
 * fixtures and then asserts the inspections find them. It used to hand-copy the
 * frontmatter into a local helper "trimmed to what matters" — so it was testing
 * the graph layer against a shape a test author typed, and the next change to
 * the real one would have sailed past it exactly the way #2036 did.
 *
 * Change the frontmatter here and that round-trip fails. That is the point.
 */
import type { DraftClaim } from '../../shared/conversation-claims-drafts';

/** Build a thought:Claim note from an extracted claim (#104). Mirrors the
 *  child-note shape of the Decompose-into-Claims skill: claim metadata in
 *  frontmatter (materialised as thought:* by the indexer), a blockquote of the
 *  supporting passage, and a `[[quote::id]]` edge to the excerpt. Typed via
 *  `type: claim` (the Claim stock object type, #2036's externalClass:
 *  thought:Claim) rather than an embedded turtle block — same convention
 *  Decompose-into-Claims and the glossary skills now use. */
export function buildClaimNoteContent(
  claim: DraftClaim,
  sourceId: string,
): string {
  const y = (s: string): string => JSON.stringify(s); // valid double-quoted YAML scalar
  return [
    '---',
    `title: ${y(claim.text)}`,
    'type: claim',
    `claimKind: ${claim.kind}`,
    `source-text: ${y(claim.quote)}`,
    `confidence: ${claim.confidence}`,
    `extracted-from: "[[sources/${sourceId}]]"`,
    'extracted-by: llm:extract-key-claims',
    '---',
    '',
    `# ${claim.text}`,
    '',
    ...claim.quote.split(/\r?\n/).map((l) => `> ${l}`),
    '',
    `[[quote::${claim.excerptId}]]`,
    '',
  ].join('\n');
}
