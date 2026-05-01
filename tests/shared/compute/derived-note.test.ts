import { describe, it, expect } from 'vitest';
import {
  buildDerivedNote,
  renderOutputToMarkdown,
  defaultDerivedNotePath,
} from '../../../src/shared/compute/derived-note';

const FROZEN_NOW = () => new Date('2026-04-20T14:22:00.000Z');

describe('buildDerivedNote (#244)', () => {
  it('produces a well-formed note with frontmatter, title, table body, and backlink', () => {
    const { markdown: md } = buildDerivedNote({
      output: {
        type: 'table',
        columns: ['station', 'trend'],
        rows: [['MLO', '2.4'], ['ALT', '2.0']],
      },
      sourcePath: 'notes/analysis/co2-analysis.md',
      cellId: '9c8f3e21',
      title: 'CO2 Trends by Station',
      now: FROZEN_NOW,
    });

    expect(md).toContain('---');
    expect(md).toContain('title: "CO2 Trends by Station"');
    // derived_from emitted as a wiki-link so the graph indexer resolves it
    // to the source's note URI and backlinks surface the derived note.
    expect(md).toContain('derived_from: "[[notes/analysis/co2-analysis]]"');
    expect(md).toContain('derived_from_cell: "9c8f3e21"');
    expect(md).toContain('derived_at: "2026-04-20T14:22:00.000Z"');
    expect(md).toContain('tags: [derived]');
    expect(md).toContain('# CO2 Trends by Station');
    expect(md).toContain('| station | trend |');
    expect(md).toContain('| MLO | 2.4 |');
    expect(md).toMatch(/\*Derived from \[\[notes\/analysis\/co2-analysis#cell-9c8f3e21\]\] on 2026-04-20\.\*/);
  });

  it('falls back to a sensible title when none is provided', () => {
    const { markdown: md } = buildDerivedNote({
      output: { type: 'text', value: 'hi' },
      sourcePath: 'notes/scratch.md',
      cellId: 'abc',
      now: FROZEN_NOW,
    });
    expect(md).toContain('title: "scratch — cell abc"');
  });

  it('image output: emits a sidecar asset + relative-path image embed (#244 phase 2)', () => {
    // 1×1 transparent PNG (`base64 -d` of this is a valid 67-byte PNG).
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAuMB8DtXNJsAAAAASUVORK5CYII=';
    const { markdown: md, assets } = buildDerivedNote({
      output: { type: 'image', mime: 'image/png', data: png },
      sourcePath: 'notes/analysis/chart.md',
      cellId: 'abc123',
      now: FROZEN_NOW,
    });
    // Asset shape: project-rooted under .minerva/assets/derived/, named
    // after the source-stem + cellId, PNG bytes decoded from base64.
    expect(assets).toHaveLength(1);
    expect(assets[0].relativePath).toBe('.minerva/assets/derived/chart-abc123.png');
    expect(assets[0].contents).toBeInstanceOf(Uint8Array);
    // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
    const bytes = assets[0].contents as Uint8Array;
    expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    // Markdown body has a relative-path embed climbing from the
    // default derived-note location (notes/derived/) to the asset.
    expect(md).toContain('![](../../.minerva/assets/derived/chart-abc123.png)');
    expect(md).not.toContain('data:image');
  });

  it('SVG output: emits the raw markup as a sidecar asset', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>';
    const { markdown: md, assets } = buildDerivedNote({
      output: { type: 'image', mime: 'image/svg+xml', data: svg },
      sourcePath: 'notes/scratch.md',
      cellId: 'abc',
      now: FROZEN_NOW,
    });
    expect(assets).toHaveLength(1);
    expect(assets[0].relativePath).toBe('.minerva/assets/derived/scratch-abc.svg');
    expect(assets[0].contents).toBe(svg);
    expect(md).toContain('![](../../.minerva/assets/derived/scratch-abc.svg)');
  });

  it('html output: inlines the markup directly into the body, no asset', () => {
    const { markdown: md, assets } = buildDerivedNote({
      output: { type: 'html', html: '<table><tr><td>cell</td></tr></table>' },
      sourcePath: 'notes/scratch.md',
      cellId: 'abc',
      now: FROZEN_NOW,
    });
    expect(assets).toEqual([]);
    expect(md).toContain('<table><tr><td>cell</td></tr></table>');
  });

  it('non-image outputs (table/text/json) emit no assets', () => {
    for (const output of [
      { type: 'table' as const, columns: ['x'], rows: [[1]] },
      { type: 'text' as const, value: 'hi' },
      { type: 'json' as const, value: { a: 1 } },
    ]) {
      const { assets } = buildDerivedNote({
        output,
        sourcePath: 'notes/x.md',
        cellId: 'abc',
        now: FROZEN_NOW,
      });
      expect(assets).toEqual([]);
    }
  });

  it('honours an explicit destPath when computing the relative image path', () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAuMB8DtXNJsAAAAASUVORK5CYII=';
    const { markdown: md } = buildDerivedNote({
      output: { type: 'image', mime: 'image/png', data: png },
      sourcePath: 'notes/scratch.md',
      cellId: 'abc',
      // Custom location — the relative path must climb from there.
      derivedPath: 'team/reports/2026/Q1/scratch-abc.md',
      now: FROZEN_NOW,
    });
    // team/reports/2026/Q1 → root is 4 ups, then into .minerva/assets/derived/.
    expect(md).toContain('![](../../../../.minerva/assets/derived/scratch-abc.png)');
  });
});

describe('renderOutputToMarkdown', () => {
  it('renders a table with columns + rows', () => {
    const md = renderOutputToMarkdown({
      type: 'table',
      columns: ['a', 'b'],
      rows: [[1, 'two']],
    });
    expect(md).toBe('| a | b |\n| --- | --- |\n| 1 | two |');
  });

  it('emits an empty-result marker for tables with no columns', () => {
    expect(renderOutputToMarkdown({ type: 'table', columns: [], rows: [] }))
      .toBe('*(empty result)*');
  });

  it('escapes pipes inside cells', () => {
    const md = renderOutputToMarkdown({
      type: 'table',
      columns: ['x'],
      rows: [['a|b']],
    });
    expect(md).toContain('| a\\|b |');
  });

  it('renders text output as a fenced code block', () => {
    expect(renderOutputToMarkdown({ type: 'text', value: 'hello\nworld' }))
      .toBe('```\nhello\nworld\n```');
  });

  it('renders JSON with pretty-printing', () => {
    const md = renderOutputToMarkdown({ type: 'json', value: { a: 1 } });
    expect(md).toBe('```json\n{\n  "a": 1\n}\n```');
  });
});

describe('defaultDerivedNotePath', () => {
  it('lands derived notes under notes/derived/ with source-stem + cell-id', () => {
    expect(defaultDerivedNotePath('notes/analysis/co2.md', 'abc123'))
      .toBe('notes/derived/co2-abc123.md');
  });

  it('sanitises awkward characters in the stem', () => {
    expect(defaultDerivedNotePath('notes/Some File (v2).md', 'x'))
      .toBe('notes/derived/Some-File-v2-x.md');
  });
});
