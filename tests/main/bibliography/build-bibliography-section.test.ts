import { describe, it, expect } from 'vitest';
import {
  buildBibliographySection,
  BIBLIOGRAPHY_OPEN_MARKER,
  BIBLIOGRAPHY_CLOSE_MARKER,
} from '../../../src/main/bibliography/generate';

type Assets = Parameters<typeof buildBibliographySection>[1];

/**
 * The pure `buildBibliographySection` doesn't need disk I/O — only a
 * minimal CitationAssets shape with a `createRenderer()` whose tracked
 * cited ids show up in `renderBibliography()`. We hand-roll a fake
 * citeproc-shaped renderer rather than spinning up the real engine,
 * since this test cares about the surrounding insert/replace logic.
 */
function fakeAssets(opts: {
  expectedIds: string[];
  excerpts?: Record<string, { sourceId: string; locator?: string }>;
}): Assets {
  const seen = new Set<string>();
  const fake = {
    style: '',
    locale: '',
    items: new Map(),
    excerpts: new Map(Object.entries(opts.excerpts ?? {})),
    knownSourceIds: opts.expectedIds,
    createRenderer: () => ({
      renderCitation: (id: string) => {
        seen.add(id);
        return '';
      },
      renderBibliography: () => ({
        entries: [...seen]
          .filter((id) => opts.expectedIds.includes(id))
          .map((id) => `<div class="csl-entry">Entry for ${id}.</div>`),
        isNote: false,
      }),
      cited: () => seen,
      missing: () => new Set<string>(),
    }),
  };
  return fake as unknown as Assets;
}

describe('buildBibliographySection (#113)', () => {
  it('appends a References section with markers when none exists', () => {
    const note = '# My Note\n\nSomething [[cite::source-a]].\n';
    const result = buildBibliographySection(
      note,
      fakeAssets({ expectedIds: ['source-a'] }),
    );
    expect(result.changed).toBe(true);
    expect(result.entriesCount).toBe(1);
    expect(result.content).toContain('## References');
    expect(result.content).toContain(BIBLIOGRAPHY_OPEN_MARKER);
    expect(result.content).toContain(BIBLIOGRAPHY_CLOSE_MARKER);
    expect(result.content).toContain('Entry for source-a.');
  });

  it('replaces an existing block in place (idempotency)', () => {
    const first = buildBibliographySection(
      '# Note\n\n[[cite::source-a]].\n',
      fakeAssets({ expectedIds: ['source-a'] }),
    );
    const second = buildBibliographySection(
      first.content,
      fakeAssets({ expectedIds: ['source-a'] }),
    );
    expect(second.content).toBe(first.content);
    expect(second.changed).toBe(false);
  });

  it('strips a stale block when there are no remaining citations', () => {
    const seeded = `# Note\n\nNo citations now.\n\n## References\n\n${BIBLIOGRAPHY_OPEN_MARKER}\n\nEntry for source-a.\n\n${BIBLIOGRAPHY_CLOSE_MARKER}\n`;
    const result = buildBibliographySection(
      seeded,
      fakeAssets({ expectedIds: [] }),
    );
    expect(result.changed).toBe(true);
    expect(result.content).not.toContain(BIBLIOGRAPHY_OPEN_MARKER);
    expect(result.content).not.toContain('## References');
  });

  it('does nothing when a note has no citations and no existing block', () => {
    const note = '# Plain note\n\nNo cites here.\n';
    const result = buildBibliographySection(
      note,
      fakeAssets({ expectedIds: [] }),
    );
    expect(result.changed).toBe(false);
    expect(result.entriesCount).toBe(0);
    expect(result.content).toBe(note);
  });

  it('resolves [[quote::id]] through the excerpts map', () => {
    const note = 'Per [[quote::ex-1]] this matters.\n';
    const result = buildBibliographySection(
      note,
      fakeAssets({
        expectedIds: ['source-a'],
        excerpts: { 'ex-1': { sourceId: 'source-a' } },
      }),
    );
    expect(result.entriesCount).toBe(1);
    expect(result.content).toContain('Entry for source-a.');
  });

  it('ignores [[cite::]] occurrences inside the bibliography block itself', () => {
    // If a bibliography entry happens to mention `[[cite::other]]`, we
    // shouldn't pick it up on the next regen — it lives inside our markers.
    const seeded =
      `# Note\n\n[[cite::source-a]].\n\n## References\n\n${BIBLIOGRAPHY_OPEN_MARKER}\n\n` +
      `Entry mentioning [[cite::not-a-real-source]].\n\n${BIBLIOGRAPHY_CLOSE_MARKER}\n`;
    const result = buildBibliographySection(
      seeded,
      fakeAssets({ expectedIds: ['source-a', 'not-a-real-source'] }),
    );
    // Only source-a should make it into the rendered bibliography.
    expect(result.content).toContain('Entry for source-a.');
    expect(result.content).not.toContain('Entry for not-a-real-source.');
  });
});
