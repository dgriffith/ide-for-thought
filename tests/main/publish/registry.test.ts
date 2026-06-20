import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerExporter,
  listExporters,
  listExportGroups,
  exportersFor,
  getExporter,
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
