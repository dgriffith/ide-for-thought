/**
 * The declarative health check (#2627): a SPARQL query plus a message
 * template, each row one finding.
 */
import { describe, it, expect } from 'vitest';
import { fillTemplate, findingsFromRows, runSparqlCheck, type SparqlCheckDef } from '../../../src/main/graph/sparql-check';

const def: SparqlCheckDef = {
  kind: 'sparql',
  type: 'contradiction',
  query: 'SELECT ?a ?aLabel ?bLabel ?notePath WHERE { }',
  subject: 'a',
  label: 'aLabel',
  notePath: 'notePath',
  message: '"{{aLabel}}" contradicts "{{ bLabel }}"',
  suggestedAction: 'Review {{aLabel}}',
};

describe('fillTemplate', () => {
  it('fills each {{var}} from the row, and an unbound one with nothing', () => {
    expect(fillTemplate('{{a}} and {{ b }} and {{c}}', { a: 'x', b: 'y' })).toBe('x and y and ');
  });
});

describe('findingsFromRows', () => {
  it('makes one finding per row, with the catalog severity', () => {
    const found = findingsFromRows(def, [
      { a: 'urn:a', aLabel: 'A', bLabel: 'B', notePath: 'claims/a.md' },
      { a: 'urn:c', aLabel: 'C', bLabel: 'D' },
    ]);
    expect(found).toEqual([
      {
        id: 'contradiction-0', type: 'contradiction', severity: 'concern',
        nodeUri: 'urn:a', nodeLabel: 'A', notePath: 'claims/a.md',
        message: '"A" contradicts "B"', suggestedAction: 'Review A',
      },
      {
        id: 'contradiction-1', type: 'contradiction', severity: 'concern',
        nodeUri: 'urn:c', nodeLabel: 'C',
        message: '"C" contradicts "D"', suggestedAction: 'Review C',
      },
    ]);
  });
});

describe('runSparqlCheck', () => {
  it('runs its own query through the given runner', async () => {
    const seen: string[] = [];
    const found = await runSparqlCheck(def, async (q) => { seen.push(q); return [{ a: 'urn:a', aLabel: 'A', bLabel: 'B' }]; });
    expect(seen).toEqual([def.query]);
    expect(found).toHaveLength(1);
  });
});
