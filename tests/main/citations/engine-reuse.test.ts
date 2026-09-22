/**
 * A reset citeproc engine is indistinguishable from a fresh one (#2210).
 *
 * This is the file that makes `CitationRenderer.reset()` — and therefore the
 * preview's engine cache — a safe change rather than a fast one.
 *
 * citeproc is stateful *on purpose*. Within a render session it tracks which
 * items have been cited (numeric styles assign [1], [2], … in first-cite
 * order), whether the previous cite was the same item (ibid. / short-form
 * rules), and a running note index for footnote styles. The old code got a
 * clean session by throwing the whole engine away and building another, at
 * ~296ms a time. Reuse only works if `reset()` puts *all* of that back, and a
 * partial reset fails in a way nothing else would catch: the markers stay
 * plausible, they just quietly stop matching what a fresh render would say —
 * a bibliography numbered from 4, a spurious "ibid.", a footnote starting at
 * 7.
 *
 * So the assertion is equality against the uncached implementation, not
 * against hardcoded expected strings: run the same session on a fresh
 * renderer and on a reused one, four times over, and demand byte equality of
 * markers, bibliography, footnotes and the missing set. Every bundled style
 * is exercised, because the state that accumulates differs by style class —
 * numeric (IEEE, Vancouver), author-date (APA, Chicago AD, MLA) and note
 * (Chicago notes & bibliography) each lean on a different part of it.
 */
import { describe, it, expect } from 'vitest';
import { CitationRenderer } from '../../../src/main/publish/csl/renderer';
import {
  BUNDLED_STYLES,
  BUNDLED_LOCALES,
  DEFAULT_LOCALE,
} from '../../../src/main/publish/csl/assets';
import type { CslItem } from '../../../src/main/publish/csl/source-to-csl';

function items(): Map<string, CslItem> {
  const m = new Map<string, CslItem>();
  const seed: Array<[string, string, string, string, number]> = [
    ['toulmin', 'The Uses of Argument', 'Toulmin', 'Stephen', 1958],
    ['kuhn', 'The Structure of Scientific Revolutions', 'Kuhn', 'Thomas', 1962],
    ['popper', 'The Logic of Scientific Discovery', 'Popper', 'Karl', 1959],
  ];
  for (const [id, title, family, given, year] of seed) {
    m.set(id, {
      id,
      type: 'book',
      title,
      author: [{ family, given }],
      issued: { 'date-parts': [[year]] },
    });
  }
  return m;
}

/**
 * One preview render's worth of work, shaped to touch every piece of session
 * state: a first cite, a cite with a locator, a REPEAT of an earlier item
 * (the ibid./short-form path), a third item (so numeric assignment has
 * somewhere to go), and an unresolvable id (the missing set).
 *
 * `tick` varies WHICH items are cited, and that is not decoration. The first
 * version of this test cited the same three items every tick — under which a
 * `reset()` that forgot `citedIds` passed on five of the six styles, because
 * a leaked cited-set that happens to equal the current one is invisible. The
 * user-visible bug is a bibliography still listing the source you just
 * deleted the cite for, which only appears when the set CHANGES between
 * ticks. So it changes here.
 */
const ROTATION = [
  ['kuhn', 'toulmin', 'popper'],
  ['popper'],
  ['toulmin', 'kuhn'],
  ['kuhn'],
] as const;

function session(r: CitationRenderer, tick: number): string {
  const cites = ROTATION[tick % ROTATION.length]!;
  const parts: string[] = [];
  for (const id of cites) parts.push(r.renderCitation(id));
  parts.push(r.renderCitation(cites[0], '12'));  // locator + repeat of a cited id
  parts.push(r.renderCitation('no-such-source')); // the missing path
  parts.push(JSON.stringify(r.renderBibliography()));
  parts.push(JSON.stringify(r.renderFootnotes()));
  parts.push(JSON.stringify([...r.missing()].sort()));
  parts.push(JSON.stringify([...r.cited()].sort()));
  return parts.join('\n');
}

const TICKS = 4;

describe.each(Object.keys(BUNDLED_STYLES))('%s', (styleId) => {
  const style = BUNDLED_STYLES[styleId]!;
  const locale = BUNDLED_LOCALES[DEFAULT_LOCALE]!;

  it('a reset renderer matches a fresh one across consecutive sessions', () => {
    // What the uncached implementation produced: a brand-new engine per tick.
    const fresh: string[] = [];
    for (let i = 0; i < TICKS; i++) {
      fresh.push(session(new CitationRenderer(style, locale, items()), i));
    }

    // Consecutive ticks must actually DIFFER, or the equality below could be
    // satisfied by a renderer that ignores its input entirely.
    expect(new Set(fresh).size, 'the rotation produced identical ticks').toBeGreaterThan(1);

    const reused = new CitationRenderer(style, locale, items());
    for (let i = 0; i < TICKS; i++) {
      reused.reset();
      expect(session(reused, i), `reused tick ${i} diverged from a fresh render`).toBe(fresh[i]);
    }
  });

  it('reset() clears the wrapper state, not only the citeproc registry', () => {
    // The half a reader is most likely to forget. `restoreProcessorState([])`
    // handles citeproc's own registry; `citedIds`, `missingIds`, `noteIndex`
    // and the footnote list are this wrapper's, and leaking any of them
    // shows up as a bibliography listing items the current note never cited.
    const r = new CitationRenderer(style, locale, items());
    r.renderCitation('kuhn');
    r.renderCitation('nope');
    expect(r.cited().size).toBe(1);
    expect(r.missing().size).toBe(1);

    r.reset();

    expect(r.cited().size, 'citedIds survived reset()').toBe(0);
    expect(r.missing().size, 'missingIds survived reset()').toBe(0);
    expect(r.renderBibliography().entries, 'bibliography survived reset()').toEqual([]);
    expect(r.renderFootnotes().notes, 'footnotes survived reset()').toEqual([]);
  });
});
