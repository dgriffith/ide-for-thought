/**
 * Pure query-building + transform tests for the `:::argument` embed (#907).
 * No DOM, no `api.*` mocking — see `argument-map-query.ts`'s module doc for
 * why this is a 1-hop-at-a-time strategy rather than a SPARQL property path.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyRelation,
  parseFocusRef,
  buildFocusQuery,
  labelFor,
  buildHopQuery,
  foldHopRows,
  filterByDepth,
  groupByKind,
  buildDefectsQuery,
  parseDefectRows,
  buildArgumentMermaid,
  type ArgumentNode,
  type HopRow,
} from '../../../src/renderer/lib/preview/argument-map-query';

describe('classifyRelation (#907)', () => {
  it('classifies support relations', () => {
    for (const r of ['supports', 'grounds', 'corroborates', 'presupposes', 'refines']) {
      expect(classifyRelation(r), r).toBe('support');
    }
  });
  it('classifies attack relations', () => {
    for (const r of ['challenges', 'rebuts', 'contradicts']) {
      expect(classifyRelation(r), r).toBe('attack');
    }
  });
  it('classifies qualify relations', () => {
    expect(classifyRelation('qualifies')).toBe('qualify');
  });
  it('falls back to "other" for an unrecognized relation', () => {
    expect(classifyRelation('cites')).toBe('other');
  });
});

describe('parseFocusRef (#907)', () => {
  it('extracts the bare target from a plain wiki-link', () => {
    expect(parseFocusRef('[[Some Claim]]')).toBe('Some Claim');
  });
  it('extracts the target ahead of a display-text pipe', () => {
    expect(parseFocusRef('[[notes/claim.md|the claim]]')).toBe('notes/claim.md');
  });
  it('strips a type prefix and anchor if present (defensive — not the intended syntax)', () => {
    expect(parseFocusRef('[[cite::some-id#section]]')).toBe('some-id');
  });
  it('returns null when the body has no wiki-link', () => {
    expect(parseFocusRef('not a link')).toBeNull();
    expect(parseFocusRef('')).toBeNull();
  });
});

describe('buildFocusQuery / labelFor (#907)', () => {
  it('embeds the escaped relative path', () => {
    const q = buildFocusQuery('notes/a "quoted" claim.md');
    expect(q).toContain('notes/a \\"quoted\\" claim.md');
    expect(q).toContain('minerva:relativePath');
  });

  it('prefers thought:label over dc:title, falling back to the given fallback', () => {
    expect(labelFor({ title: 'T', label: 'L' }, 'fallback')).toBe('L');
    expect(labelFor({ label: 'L' }, 'fallback')).toBe('L');
    expect(labelFor({ title: 'T' }, 'fallback')).toBe('T');
    expect(labelFor({}, 'fallback')).toBe('fallback');
  });
});

describe('buildHopQuery (#907)', () => {
  it('embeds every frontier URI as a VALUES binding', () => {
    const q = buildHopQuery(['https://x/a', 'https://x/b']);
    expect(q).toContain('<https://x/a>');
    expect(q).toContain('<https://x/b>');
    expect(q).toContain('VALUES ?target');
  });

  it('constrains ?relation to the full known relation set', () => {
    const q = buildHopQuery(['https://x/a']);
    for (const r of ['supports', 'challenges', 'grounds', 'rebuts', 'qualifies', 'contradicts', 'corroborates', 'presupposes', 'refines']) {
      expect(q, r).toContain(`thought:${r}`);
    }
  });
});

describe('foldHopRows (#907)', () => {
  const rows: HopRow[] = [
    { node: 'https://x/grounds', relation: 'https://minerva.dev/ontology/thought#supports', target: 'https://x/focus', title: 'Grounds note' },
    { node: 'https://x/rebuttal', relation: 'https://minerva.dev/ontology/thought#challenges', target: 'https://x/focus', label: 'Rebuttal note' },
    // Duplicate node reached via a second relation this same hop — first one wins.
    { node: 'https://x/grounds', relation: 'https://minerva.dev/ontology/thought#corroborates', target: 'https://x/focus', title: 'ignored' },
  ];

  it('dedupes within a hop, keeping the first relation seen', () => {
    const nodes = foldHopRows(rows, 1, new Set());
    expect(nodes).toHaveLength(2);
    const grounds = nodes.find((n) => n.uri === 'https://x/grounds')!;
    expect(grounds.relation).toBe('supports');
    expect(grounds.kind).toBe('support');
    expect(grounds.label).toBe('Grounds note');
    expect(grounds.parentUri).toBe('https://x/focus');
    expect(grounds.hop).toBe(1);
  });

  it('skips a node already known from an earlier (shorter) hop', () => {
    const nodes = foldHopRows(rows, 2, new Set(['https://x/grounds']));
    expect(nodes.map((n) => n.uri)).toEqual(['https://x/rebuttal']);
  });

  it('skips rows missing node/relation/target', () => {
    expect(foldHopRows([{ node: 'x' }], 1, new Set())).toEqual([]);
  });

  it('reads the role type local name when bound', () => {
    const [n] = foldHopRows(
      [{ node: 'https://x/g', relation: 'https://minerva.dev/ontology/thought#supports', target: 'https://x/f', roleType: 'https://minerva.dev/ontology/thought#Grounds' }],
      1,
      new Set(),
    );
    expect(n!.roleType).toBe('Grounds');
  });
});

function node(overrides: Partial<ArgumentNode>): ArgumentNode {
  return {
    uri: 'https://x/n',
    label: 'N',
    notePath: null,
    roleType: null,
    relation: 'supports',
    kind: 'support',
    hop: 1,
    parentUri: 'https://x/focus',
    ...overrides,
  };
}

describe('filterByDepth (#907)', () => {
  it('keeps only nodes at or below the given depth', () => {
    const nodes = [node({ uri: 'a', hop: 1 }), node({ uri: 'b', hop: 2 }), node({ uri: 'c', hop: 3 })];
    expect(filterByDepth(nodes, 2).map((n) => n.uri)).toEqual(['a', 'b']);
    expect(filterByDepth(nodes, 1).map((n) => n.uri)).toEqual(['a']);
    expect(filterByDepth(nodes, 3).map((n) => n.uri)).toEqual(['a', 'b', 'c']);
  });
});

describe('groupByKind (#907)', () => {
  it('buckets support/attack/qualify/other separately', () => {
    const nodes = [
      node({ uri: 'a', kind: 'support' }),
      node({ uri: 'b', kind: 'attack' }),
      node({ uri: 'c', kind: 'qualify' }),
      node({ uri: 'd', kind: 'other' }),
    ];
    const grouped = groupByKind(nodes);
    expect(grouped.support.map((n) => n.uri)).toEqual(['a']);
    expect(grouped.attack.map((n) => n.uri)).toEqual(['b']);
    expect(grouped.qualify.map((n) => n.uri)).toEqual(['c']);
    expect(grouped.other.map((n) => n.uri)).toEqual(['d']);
  });

  it('returns empty arrays for a kind with no members, not undefined', () => {
    expect(groupByKind([])).toEqual({ support: [], attack: [], qualify: [], other: [] });
  });
});

describe('buildDefectsQuery / parseDefectRows (#907)', () => {
  it('returns null for an empty note-path set — nothing to scope the query to', () => {
    expect(buildDefectsQuery([])).toBeNull();
  });

  it('dedupes note paths and embeds them as VALUES', () => {
    const q = buildDefectsQuery(['notes/a.md', 'notes/a.md', 'notes/b.md']);
    expect(q).toContain('"notes/a.md"');
    expect(q).toContain('"notes/b.md"');
    expect((q!.match(/notes\/a\.md/g) ?? []).length).toBe(1);
  });

  it('parses rows, preferring defectLabel then the type local name then a generic fallback', () => {
    const parsed = parseDefectRows([
      { defect: 'https://x/d1', defectLabel: 'Hasty generalization', notePath: 'notes/a.md' },
      { defect: 'https://x/d2', defectType: 'https://minerva.dev/ontology/thought#ConfirmationBias', notePath: 'notes/a.md' },
      { defect: 'https://x/d3', notePath: 'notes/a.md' },
      { notePath: 'notes/a.md' }, // dropped: no defect uri
    ]);
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toMatchObject({ label: 'Hasty generalization', typeName: null });
    expect(parsed[1]).toMatchObject({ label: 'ConfirmationBias', typeName: 'ConfirmationBias' });
    expect(parsed[2]).toMatchObject({ label: 'Defect', typeName: null });
  });
});

describe('buildArgumentMermaid (#907)', () => {
  it('renders the focus node plus each argument node, styled by kind', () => {
    const nodes = [
      node({ uri: 'https://x/g', label: 'Cited data', kind: 'support', relation: 'supports', roleType: 'Grounds' }),
      node({ uri: 'https://x/r', label: 'Counterexample', kind: 'attack', relation: 'rebuts' }),
    ];
    const src = buildArgumentMermaid('https://x/focus', 'The claim', nodes);
    expect(src).toContain('graph TD');
    expect(src).toContain('focus["The claim"]');
    expect(src).toContain('Grounds: Cited data');
    expect(src).toContain('Counterexample');
    expect(src).toContain('-->|supports| focus');
    expect(src).toContain('-->|rebuts| focus');
    expect(src).toContain('argSupport');
    expect(src).toContain('argAttack');
  });

  it('draws a deeper node to its actual parent, not straight to the focus', () => {
    const grounds = node({ uri: 'https://x/g', label: 'Grounds', hop: 1, parentUri: 'https://x/focus' });
    const backing = node({ uri: 'https://x/b', label: 'Backing', hop: 2, parentUri: 'https://x/g' });
    const src = buildArgumentMermaid('https://x/focus', 'The claim', [grounds, backing]);
    // Backing's edge targets Grounds's generated id, not "focus".
    const groundsLine = src.split('\n').find((l) => l.includes('"Grounds"'))!;
    const groundsId = groundsLine.trim().split('[')[0]!;
    expect(src).toContain(`-->|${backing.relation}| ${groundsId}`);
  });

  it('escapes double quotes and caps very long labels', () => {
    const long = 'x'.repeat(200);
    const src = buildArgumentMermaid('https://x/focus', `say "hi"`, [node({ uri: 'https://x/n', label: long })]);
    expect(src).toContain('&quot;hi&quot;');
    expect(src).not.toContain(long);
  });
});
