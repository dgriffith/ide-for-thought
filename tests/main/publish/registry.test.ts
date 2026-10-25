import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  registerExporter,
  listExporters,
  listExportGroups,
  exportersFor,
  getExporter,
  exportGroupOf,
  setExtraExporters,
  _clearRegistry,
} from '../../../src/main/publish/registry';
import type { Exporter, ExportGroupId } from '../../../src/main/publish/types';

function mkExporter(id: string, opts: { accepts?: boolean; group?: ExportGroupId } = {}): Exporter {
  return {
    id,
    label: id,
    group: opts.group ?? 'markdown',
    accepts: () => opts.accepts ?? true,
    async run() { return { files: [], summary: '' }; },
  };
}

describe('publish registry (#246)', () => {
  beforeEach(() => _clearRegistry());

  it('registers and looks up by id', () => {
    const e = mkExporter('markdown');
    registerExporter(e);
    expect(getExporter('markdown')).toBe(e);
    expect(getExporter('unknown')).toBeNull();
  });

  it('listExporters returns them in insertion order', () => {
    registerExporter(mkExporter('a'));
    registerExporter(mkExporter('b'));
    registerExporter(mkExporter('c'));
    expect(listExporters().map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('exportersFor filters out exporters whose accepts() returns false', () => {
    registerExporter(mkExporter('yes', { accepts: true }));
    registerExporter(mkExporter('no', { accepts: false }));
    const list = exportersFor({ kind: 'project' });
    expect(list.map((x) => x.id)).toEqual(['yes']);
  });

  describe('listExportGroups (format-first menu)', () => {
    it('collapses exporters into ordered format families', () => {
      // Register out of menu order to prove the result is sorted by group order.
      registerExporter(mkExporter('bibtex', { group: 'bibtex' }));
      registerExporter(mkExporter('note-html', { group: 'html' }));
      registerExporter(mkExporter('note-md', { group: 'markdown' }));
      registerExporter(mkExporter('note-md-clean', { group: 'markdown' }));

      const groups = listExportGroups();
      // markdown (1) before html (2) before bibtex (6).
      expect(groups.map((g) => g.group.id)).toEqual(['markdown', 'html', 'bibtex']);
      // Both markdown exporters collapse under one family entry.
      expect(groups[0].exporterIds).toEqual(['note-md', 'note-md-clean']);
      expect(groups[0].group.label).toBe('Markdown');
    });

    it('returns nothing when no exporters are registered', () => {
      expect(listExportGroups()).toEqual([]);
    });
  });
});

describe('exporters from outside the source (#2648)', () => {
  beforeEach(() => _clearRegistry());
  afterEach(() => setExtraExporters(null));

  const plugin = (id: string): Exporter => ({
    ...mkExporter(id),
    group: `plugin:${id}`,
    groupMeta: { id: `plugin:${id}`, label: 'EPUB', category: 'publication', order: 100 },
  });

  it('joins the list and the lookup after the built-ins, each in its own family, and goes when dropped', () => {
    registerExporter(mkExporter('md', { group: 'markdown' }));
    setExtraExporters(() => [plugin('epub/epub')]);
    expect(listExporters().map((e) => e.id)).toEqual(['md', 'epub/epub']);
    expect(getExporter('epub/epub')?.label).toBe('epub/epub');
    expect(listExportGroups().map((g) => [g.group.id, g.group.label, g.exporterIds])).toEqual([
      ['markdown', 'Markdown', ['md']],
      ['plugin:epub/epub', 'EPUB', ['epub/epub']],
    ]);
    expect(exportGroupOf(plugin('epub/epub')).label).toBe('EPUB');
    setExtraExporters(() => []);
    expect(getExporter('epub/epub')).toBeNull();
  });

  it('never replaces a built-in with the same id', () => {
    const builtIn = mkExporter('md');
    registerExporter(builtIn);
    setExtraExporters(() => [plugin('md')]);
    expect(getExporter('md')).toBe(builtIn);
    expect(listExporters()).toHaveLength(1);
  });
});
