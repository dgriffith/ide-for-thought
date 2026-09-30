/**
 * A large, citation-heavy note for the renderer benches (#2385).
 *
 * Shaped like a real research note rather than repeated filler: ATX headings,
 * prose paragraphs carrying wiki-links, tags, `[[cite::…]]` and
 * `[[quote::…]]` links, a fenced code block every few sections, footnotes and
 * a bullet list. Every construct the preview's markdown plugins and the
 * editor's decoration layers handle appears many times over, so a bench over it
 * exercises those paths at scale instead of timing plain paragraphs.
 *
 * Deterministic (no Math.random) so runs are comparable.
 */

export interface LargeNote {
  text: string;
  lines: number;
  /** Distinct `[[cite::id]]` links in document order. */
  citeCount: number;
  /** Distinct `[[quote::id]]` links in document order. */
  quoteCount: number;
  /** Source ids the cite links name (with repeats — a source is cited more than once). */
  sourceIds: string[];
  excerptIds: string[];
}

export function buildLargeNote(sections: number, citesPerSection: number): LargeNote {
  const out: string[] = ['---', 'title: Large research note', 'tags: [bench, research]', '---', ''];
  const sourceIds: string[] = [];
  const excerptIds: string[] = [];
  for (let s = 0; s < sections; s++) {
    out.push(`## Section ${s}: on the structure of argument ${s}`, '');
    for (let c = 0; c < citesPerSection; c++) {
      // Sources repeat across sections, as they do in a real note — the
      // cite-meta cache and numeric CSL markers both depend on that.
      const sid = `source-${(s * citesPerSection + c) % 150}`;
      sourceIds.push(sid);
      out.push(
        `Claim ${s}.${c} builds on [[note-${(s + c) % 300}]] and #topic-${c % 12}; ` +
          `the evidence is summarised in [[cite::${sid}]], which the *earlier* ` +
          `**discussion** in [[Section notes ${s % 40}|section notes]] qualifies.`,
        '',
      );
    }
    const eid = `excerpt-${s % 80}`;
    excerptIds.push(eid);
    out.push(`> A quoted passage for section ${s}. [[quote::${eid}]]`, '');
    out.push(
      `- first point, see [[note-${(s * 7) % 300}]]`,
      `- second point with a footnote[^fn${s}]`,
      `- third point, #followup`,
      '',
    );
    if (s % 5 === 0) {
      out.push('```python', `def section_${s}(x):`, `    return x * ${s}`, '```', '');
    }
    out.push(`[^fn${s}]: Footnote body for section ${s}.`, '');
  }
  const text = out.join('\n');
  return {
    text,
    lines: out.length,
    citeCount: sourceIds.length,
    quoteCount: excerptIds.length,
    sourceIds,
    excerptIds,
  };
}
