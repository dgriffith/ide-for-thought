import { describe, it, expect } from 'vitest';
import {
  extractSummary,
  buildAutoLinkToPrompt,
  parseAutoLinkResponse,
  applyLinkInsertions,
} from '../../../src/shared/refactor/auto-link';

describe('extractSummary (issue #175)', () => {
  it('prefers the frontmatter description when provided', () => {
    const s = extractSummary('# Title\n\nBody paragraph.', 'Short description.');
    expect(s).toBe('Short description.');
  });

  it('falls back to the first non-empty paragraph of body', () => {
    const body = '# Title\n\nFirst paragraph.\n\nSecond paragraph.';
    expect(extractSummary(body)).toBe('First paragraph.');
  });

  it('strips code fences and headings before finding the paragraph', () => {
    const body = '# Title\n\n```js\nconst x = 1;\n```\n\nReal paragraph.';
    expect(extractSummary(body)).toBe('Real paragraph.');
  });

  it('truncates to the char budget with an ellipsis', () => {
    const body = 'A'.repeat(500);
    const s = extractSummary(body);
    expect(s.length).toBeLessThanOrEqual(361); // budget 360 + ellipsis
    expect(s.endsWith('\u2026')).toBe(true);
  });

  it('returns empty when body has no prose', () => {
    expect(extractSummary('# Only a heading')).toBe('');
  });
});

describe('buildAutoLinkToPrompt', () => {
  it('lists each candidate by path, title, and summary', () => {
    const prompt = buildAutoLinkToPrompt({
      activeTitle: 'Active',
      activeBody: 'Some content.',
      candidates: [
        { relativePath: 'ml.md', title: 'Machine Learning', summary: 'ML intro.' },
        { relativePath: 'bias.md', title: 'Cognitive Bias', summary: 'Bias intro.' },
      ],
    });
    expect(prompt).toContain('`ml.md`');
    expect(prompt).toContain('**Machine Learning**');
    expect(prompt).toContain('ML intro.');
    expect(prompt).toContain('`bias.md`');
  });

  it('renders "(no summary)" when a candidate has an empty summary', () => {
    const prompt = buildAutoLinkToPrompt({
      activeTitle: 'A',
      activeBody: 'Body.',
      candidates: [{ relativePath: 'x.md', title: 'X', summary: '' }],
    });
    expect(prompt).toContain('(no summary)');
  });

  it('spells out the verbatim-anchor and return-shape rules', () => {
    const prompt = buildAutoLinkToPrompt({ activeTitle: '', activeBody: '', candidates: [] });
    expect(prompt).toMatch(/verbatim substring/i);
    expect(prompt).toContain('anchorText');
    expect(prompt).toContain('target');
  });
});

describe('parseAutoLinkResponse', () => {
  const valid = new Set(['ml.md', 'bias.md']);

  it('parses a bare JSON array', () => {
    const raw = '[{"anchorText":"machine learning","target":"ml.md","rationale":"matches"}]';
    expect(parseAutoLinkResponse(raw, valid)).toEqual([
      { anchorText: 'machine learning', target: 'ml.md', rationale: 'matches' },
    ]);
  });

  it('strips surrounding prose before the JSON array', () => {
    const raw = 'Here you go:\n[{"anchorText":"x","target":"ml.md","rationale":""}]\nLet me know.';
    expect(parseAutoLinkResponse(raw, valid)).toEqual([
      { anchorText: 'x', target: 'ml.md', rationale: '' },
    ]);
  });

  it('strips markdown code fences', () => {
    const raw = '```json\n[{"anchorText":"x","target":"ml.md","rationale":""}]\n```';
    expect(parseAutoLinkResponse(raw, valid)).toEqual([
      { anchorText: 'x', target: 'ml.md', rationale: '' },
    ]);
  });

  it('drops entries with unknown targets', () => {
    const raw = '[{"anchorText":"x","target":"nonexistent.md","rationale":""}]';
    expect(parseAutoLinkResponse(raw, valid)).toEqual([]);
  });

  it('drops entries missing required fields', () => {
    const raw = '[{"anchorText":"x"},{"target":"ml.md"},{"anchorText":"y","target":"ml.md"}]';
    expect(parseAutoLinkResponse(raw, valid)).toEqual([
      { anchorText: 'y', target: 'ml.md', rationale: '' },
    ]);
  });

  it('returns [] for non-array / malformed JSON', () => {
    expect(parseAutoLinkResponse('not JSON', valid)).toEqual([]);
    expect(parseAutoLinkResponse('{"anchorText":"x"}', valid)).toEqual([]);
  });
});

describe('applyLinkInsertions', () => {
  it('replaces anchor text with [[target-stem|anchor]] on first occurrence', () => {
    const out = applyLinkInsertions(
      'I care about machine learning and AI.',
      [{ anchorText: 'machine learning', target: 'ml.md', rationale: '' }],
    );
    expect(out.content).toBe('I care about [[ml|machine learning]] and AI.');
    expect(out.applied).toHaveLength(1);
    expect(out.skipped).toHaveLength(0);
  });

  it('uses bare [[stem]] when the anchor already matches the target stem', () => {
    const out = applyLinkInsertions(
      'See ml for details.',
      [{ anchorText: 'ml', target: 'ml.md', rationale: '' }],
    );
    expect(out.content).toContain('[[ml]]');
  });

  it('skips anchor text already inside a [[\u2026]] wiki-link', () => {
    const out = applyLinkInsertions(
      '[[existing|machine learning]] and later machine learning again',
      [{ anchorText: 'machine learning', target: 'ml.md', rationale: '' }],
    );
    // Should replace the SECOND occurrence, not the one inside the existing link.
    expect(out.content).toContain('[[existing|machine learning]]');
    expect(out.content).toContain('[[ml|machine learning]] again');
    expect(out.applied).toHaveLength(1);
  });

  it('reports skipped when the anchor text isn\u2019t found', () => {
    const out = applyLinkInsertions(
      'Some unrelated text.',
      [{ anchorText: 'machine learning', target: 'ml.md', rationale: '' }],
    );
    expect(out.content).toBe('Some unrelated text.');
    expect(out.applied).toHaveLength(0);
    expect(out.skipped).toHaveLength(1);
  });

  it('applies longer anchors first so nested overlaps don\u2019t clobber each other', () => {
    const out = applyLinkInsertions(
      'The machine learning model improves machine performance.',
      [
        { anchorText: 'machine', target: 'machine.md', rationale: '' },
        { anchorText: 'machine learning', target: 'ml.md', rationale: '' },
      ],
    );
    expect(out.content).toContain('[[ml|machine learning]]');
    // The second `machine` (standalone) still gets its own link.
    expect(out.content).toContain('[[machine]] performance');
    expect(out.applied).toHaveLength(2);
  });

  it('strips folder paths to just the stem when building the link target', () => {
    const out = applyLinkInsertions(
      'Fusion is hot.',
      [{ anchorText: 'Fusion', target: 'physics/fusion.md', rationale: '' }],
    );
    // Stem = "physics/fusion" (no .md extension). Full path preserved; only .md suffix is stripped.
    expect(out.content).toContain('[[physics/fusion|Fusion]]');
  });
});
