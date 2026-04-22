import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerExporter,
  listExporters,
  exportersFor,
  getExporter,
  _clearRegistry,
} from '../../../src/main/publish/registry';
import type { Exporter } from '../../../src/main/publish/types';

function mkExporter(id: string, accepts = true): Exporter {
  return {
    id,
    label: id,
    accepts: () => accepts,
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
    registerExporter(mkExporter('yes', true));
    registerExporter(mkExporter('no', false));
    const list = exportersFor({ kind: 'project' });
    expect(list.map((x) => x.id)).toEqual(['yes']);
  });
});
