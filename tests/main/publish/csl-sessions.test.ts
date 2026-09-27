/**
 * `createRendererSessions` — one compiled engine per export, a clean session
 * per call (#2408).
 *
 * Two layers. The fake-factory tests pin the handle's own contract (lazy,
 * compiles once, resets on every later call, forwards the output format). The
 * real-engine tests pin what makes it safe to use in an exporter: a session
 * served by the shared engine renders byte-identically to one served by a
 * brand-new engine. `tests/main/citations/engine-reuse.test.ts` already proves
 * that for `html` output and `renderBibliography()`; exporters additionally
 * use `text` output (the markdown exporters) and `renderBibliographyFor()`
 * (every bundle-level bibliography), so those are the paths covered here.
 */
import { describe, it, expect, vi } from 'vitest';
import { createRendererSessions } from '../../../src/main/publish/csl';
import { CitationRenderer } from '../../../src/main/publish/csl/renderer';
import { BUNDLED_STYLES, BUNDLED_LOCALES, DEFAULT_LOCALE } from '../../../src/main/publish/csl/assets';
import type { CslItem } from '../../../src/main/publish/csl/source-to-csl';

function fakeFactory() {
  const reset = vi.fn();
  const renderer = { reset } as unknown as CitationRenderer;
  const createRenderer = vi.fn((_opts?: { outputFormat?: 'html' | 'text' }) => renderer);
  return { createRenderer, renderer, reset };
}

describe('createRendererSessions — the handle', () => {
  it('compiles nothing until the first session is asked for', () => {
    const f = fakeFactory();
    createRendererSessions(f);
    expect(f.createRenderer).not.toHaveBeenCalled();
  });

  it('compiles exactly once across many sessions', () => {
    const f = fakeFactory();
    const sessions = createRendererSessions(f);
    for (let i = 0; i < 5; i++) sessions.next();
    expect(f.createRenderer).toHaveBeenCalledTimes(1);
  });

  it('hands back the same renderer every time', () => {
    const f = fakeFactory();
    const sessions = createRendererSessions(f);
    expect(sessions.next()).toBe(sessions.next());
  });

  it('does not reset the brand-new renderer it just compiled', () => {
    const f = fakeFactory();
    createRendererSessions(f).next();
    expect(f.reset).not.toHaveBeenCalled();
  });

  it('resets before every session after the first', () => {
    const f = fakeFactory();
    const sessions = createRendererSessions(f);
    for (let i = 0; i < 4; i++) sessions.next();
    expect(f.reset).toHaveBeenCalledTimes(3);
  });

  it('forwards the output format to the one compile', () => {
    const f = fakeFactory();
    createRendererSessions(f, { outputFormat: 'text' }).next();
    expect(f.createRenderer).toHaveBeenCalledWith({ outputFormat: 'text' });
  });

  it('returns undefined when the plan has no citation assets', () => {
    expect(createRendererSessions(undefined).next()).toBeUndefined();
  });
});

// ── Real engine: shared sessions are indistinguishable from fresh engines ──

function items(): Map<string, CslItem> {
  const m = new Map<string, CslItem>();
  const seed: Array<[string, string, string, number]> = [
    ['toulmin', 'The Uses of Argument', 'Toulmin', 1958],
    ['kuhn', 'The Structure of Scientific Revolutions', 'Kuhn', 1962],
    ['popper', 'The Logic of Scientific Discovery', 'Popper', 1959],
  ];
  for (const [id, title, family, year] of seed) {
    m.set(id, { id, type: 'book', title, author: [{ family, given: 'A.' }], issued: { 'date-parts': [[year]] } });
  }
  return m;
}

/**
 * The shape of one multi-note export: three per-note sessions whose cited
 * sets differ (so leaked state would show), then a bundle bibliography built
 * through `renderBibliographyFor` on a further session.
 */
const NOTES = [['kuhn', 'toulmin'], ['popper'], []] as const;
const BUNDLE = ['kuhn', 'popper', 'toulmin'];

function runExport(next: () => CitationRenderer): string[] {
  const out: string[] = [];
  for (const cites of NOTES) {
    const r = next();
    const marks = cites.map((id) => r.renderCitation(id));
    out.push(JSON.stringify({
      marks,
      bib: r.renderBibliography(),
      footnotes: r.renderFootnotes(),
      cited: [...r.cited()].sort(),
    }));
  }
  out.push(JSON.stringify(next().renderBibliographyFor(BUNDLE)));
  return out;
}

// Numeric (ieee) and author-date (mla): two cheap-to-compile styles that lean
// on different session state. The note class is covered in both output
// formats by the Chicago cases in the exporter suites.
describe.each([
  ['ieee', 'text'],
  ['ieee', 'html'],
  ['mla', 'text'],
  ['mla', 'html'],
] as const)('%s / %s: a shared-engine export matches a fresh-engine one', (styleId, outputFormat) => {
  it('byte-identical per-note sessions and bundle bibliography', () => {
    const style = BUNDLED_STYLES[styleId]!;
    const locale = BUNDLED_LOCALES[DEFAULT_LOCALE]!;
    const factory = {
      createRenderer: (opts?: { outputFormat?: 'html' | 'text' }) =>
        new CitationRenderer(style, locale, items(), opts),
    };

    const fresh = runExport(() => factory.createRenderer({ outputFormat }));
    const sessions = createRendererSessions(factory, { outputFormat });
    const shared = runExport(() => sessions.next()!);

    expect(shared).toEqual(fresh);
  });
});
