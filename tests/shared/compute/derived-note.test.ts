import { describe, it, expect } from 'vitest';
import {
  buildDerivedNote,
  renderOutputToMarkdown,
  defaultDerivedNotePath,
} from '../../../src/shared/compute/derived-note';

const FROZEN_NOW = () => new Date('2026-04-20T14:22:00.000Z');

describe('buildDerivedNote (#244)', () => {
  it('produces a well-formed note with frontmatter, title, table body, and backlink', () => {
    const md = buildDerivedNote({
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
    const md = buildDerivedNote({
      output: { type: 'text', value: 'hi' },
      sourcePath: 'notes/scratch.md',
      cellId: 'abc',
      now: FROZEN_NOW,
    });
    expect(md).toContain('title: "scratch — cell abc"');
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
