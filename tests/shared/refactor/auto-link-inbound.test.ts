import { describe, it, expect } from 'vitest';
import {
  buildAutoLinkInboundPrompt,
  parseInboundResponse,
  snippetAround,
} from '../../../src/shared/refactor/auto-link-inbound';

describe('buildAutoLinkInboundPrompt (issue #175 part 2)', () => {
  it('embeds the active note summary and each candidate\u2019s full body', () => {
    const prompt = buildAutoLinkInboundPrompt({
      activeTitle: 'Entropy',
      activePath: 'physics/entropy.md',
      activeSummary: 'How disorder scales in closed systems.',
      candidates: [
        { relativePath: 'thermo.md', title: 'Thermodynamics', body: 'The second law states that entropy in a closed system never decreases.' },
      ],
    });
    expect(prompt).toContain('Entropy');
    expect(prompt).toContain('physics/entropy.md');
    expect(prompt).toContain('disorder scales in closed systems');
    expect(prompt).toContain('Thermodynamics');
    expect(prompt).toContain('second law');
    expect(prompt).toContain('`thermo.md`');
  });

  it('mentions that the link target will be the active note stem', () => {
    const prompt = buildAutoLinkInboundPrompt({
      activeTitle: 'X',
      activePath: 'notes/x.md',
      activeSummary: '',
      candidates: [],
    });
    expect(prompt).toContain('[[notes/x]]');
  });

  it('restates the verbatim-anchor and JSON-output rules', () => {
    const prompt = buildAutoLinkInboundPrompt({
      activeTitle: '', activePath: 'a.md', activeSummary: '', candidates: [],
    });
    expect(prompt).toMatch(/verbatim substring/i);
    expect(prompt).toContain('"source"');
    expect(prompt).toContain('"anchorText"');
  });
});

describe('parseInboundResponse', () => {
  const valid = new Set(['thermo.md', 'stat-mech.md']);

  it('parses a bare JSON array', () => {
    const raw = '[{"source":"thermo.md","anchorText":"entropy","rationale":"matches active"}]';
    expect(parseInboundResponse(raw, valid)).toEqual([
      { source: 'thermo.md', anchorText: 'entropy', rationale: 'matches active' },
    ]);
  });

  it('tolerates markdown code fences and prose around the array', () => {
    const raw = 'Here you go:\n```json\n[{"source":"stat-mech.md","anchorText":"microstates","rationale":""}]\n```\nDone.';
    expect(parseInboundResponse(raw, valid)).toEqual([
      { source: 'stat-mech.md', anchorText: 'microstates', rationale: '' },
    ]);
  });

  it('drops entries with unknown sources', () => {
    const raw = '[{"source":"nonexistent.md","anchorText":"x","rationale":""}]';
    expect(parseInboundResponse(raw, valid)).toEqual([]);
  });

  it('drops entries missing required fields', () => {
    const raw = '[{"source":"thermo.md"},{"anchorText":"y"},{"source":"thermo.md","anchorText":"z"}]';
    expect(parseInboundResponse(raw, valid)).toEqual([
      { source: 'thermo.md', anchorText: 'z', rationale: '' },
    ]);
  });

  it('returns [] for malformed or non-array JSON', () => {
    expect(parseInboundResponse('not JSON', valid)).toEqual([]);
    expect(parseInboundResponse('{"source":"thermo.md"}', valid)).toEqual([]);
  });
});

describe('snippetAround', () => {
  it('renders the anchor bracketed by \u00BB / \u00AB with surrounding context', () => {
    const body = 'In thermodynamics, entropy tends to increase in closed systems over time.';
    const snippet = snippetAround(body, 'entropy', 20);
    expect(snippet).toContain('\u00BBentropy\u00AB');
    expect(snippet.length).toBeLessThanOrEqual(body.length + 4); // ellipsis + markers
  });

  it('adds leading/trailing ellipsis when context is truncated', () => {
    const body = 'A'.repeat(200) + ' target ' + 'B'.repeat(200);
    const s = snippetAround(body, 'target', 20);
    expect(s.startsWith('\u2026')).toBe(true);
    expect(s.endsWith('\u2026')).toBe(true);
  });

  it('returns empty when the anchor is not in the body', () => {
    expect(snippetAround('hello world', 'missing')).toBe('');
  });

  it('collapses runs of whitespace into single spaces', () => {
    const body = 'before\n\n\ttarget\n\nafter';
    const s = snippetAround(body, 'target');
    expect(s).not.toMatch(/\s{2,}/);
  });
});
