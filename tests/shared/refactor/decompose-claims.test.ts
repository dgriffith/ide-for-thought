/**
 * Unit coverage for the pure shared piece of #408 — the prompt builder
 * and the JSON-response parser. The orchestrator's integration test
 * exercises this through the full pipe, but the parser deserves direct
 * cases for malformed input, kind validation, and code-fence tolerance.
 */

import { describe, it, expect } from 'vitest';
import {
  buildDecomposeClaimsPrompt,
  parseDecomposeClaimsResponse,
  escapeTurtleLiteral,
  CLAIM_KINDS,
} from '../../../src/shared/refactor/decompose-claims';

describe('buildDecomposeClaimsPrompt', () => {
  it('embeds the passage verbatim in the prompt', () => {
    const passage = 'A long passage with "quotes" and \\backslashes.';
    const out = buildDecomposeClaimsPrompt({ passage });
    expect(out).toContain(passage);
  });

  it('includes the source title when given', () => {
    const out = buildDecomposeClaimsPrompt({
      sourceTitle: 'standup-2026-04-26',
      passage: 'x',
    });
    expect(out).toContain('## Source: standup-2026-04-26');
  });

  it('omits the source-title heading when absent', () => {
    const out = buildDecomposeClaimsPrompt({ passage: 'x' });
    expect(out).not.toContain('## Source:');
  });

  it('lists every supported claim kind so the model knows the closed set', () => {
    const out = buildDecomposeClaimsPrompt({ passage: 'x' });
    for (const kind of CLAIM_KINDS) {
      expect(out).toContain(`**${kind}**`);
    }
  });
});

describe('parseDecomposeClaimsResponse', () => {
  it('returns an empty list (no error) for an empty response', () => {
    const r = parseDecomposeClaimsResponse('');
    expect(r.claims).toEqual([]);
    expect(r.error).toBe('');
  });

  it('parses a clean JSON body', () => {
    const r = parseDecomposeClaimsResponse(JSON.stringify({
      claims: [
        { label: 'A', sourceText: 'a', kind: 'factual' },
        { label: 'B', sourceText: 'b', kind: 'evaluative' },
      ],
    }));
    expect(r.error).toBe('');
    expect(r.claims).toHaveLength(2);
    expect(r.claims[0].kind).toBe('factual');
    expect(r.claims[1].kind).toBe('evaluative');
  });

  it('strips a ```json fence even though the prompt forbids it', () => {
    const wrapped = '```json\n' + JSON.stringify({
      claims: [{ label: 'X', sourceText: 'x', kind: 'predictive' }],
    }) + '\n```';
    const r = parseDecomposeClaimsResponse(wrapped);
    expect(r.error).toBe('');
    expect(r.claims).toHaveLength(1);
    expect(r.claims[0].kind).toBe('predictive');
  });

  it('strips a bare ``` fence (no language tag)', () => {
    const wrapped = '```\n' + JSON.stringify({
      claims: [{ label: 'X', sourceText: 'x', kind: 'definitional' }],
    }) + '\n```';
    const r = parseDecomposeClaimsResponse(wrapped);
    expect(r.error).toBe('');
    expect(r.claims).toHaveLength(1);
  });

  it('returns a parse error when the body is not JSON at all', () => {
    const r = parseDecomposeClaimsResponse('totally unrelated prose');
    expect(r.claims).toEqual([]);
    expect(r.error).toMatch(/parse/i);
  });

  it('returns a shape error when "claims" is missing', () => {
    const r = parseDecomposeClaimsResponse(JSON.stringify({ stuff: [] }));
    expect(r.claims).toEqual([]);
    expect(r.error).toMatch(/claims/);
  });

  it('drops claims with unknown kinds rather than throwing', () => {
    const r = parseDecomposeClaimsResponse(JSON.stringify({
      claims: [
        { label: 'ok', sourceText: 'ok', kind: 'factual' },
        { label: 'bad', sourceText: 'bad', kind: 'speculative-with-vibes' },
      ],
    }));
    expect(r.error).toBe('');
    expect(r.claims).toHaveLength(1);
    expect(r.claims[0].label).toBe('ok');
  });

  it('drops claims missing label or sourceText', () => {
    const r = parseDecomposeClaimsResponse(JSON.stringify({
      claims: [
        { label: '', sourceText: 'x', kind: 'factual' },
        { label: 'y', sourceText: '', kind: 'factual' },
        { label: 'z', sourceText: 'z', kind: 'factual' },
      ],
    }));
    expect(r.error).toBe('');
    expect(r.claims).toHaveLength(1);
    expect(r.claims[0].label).toBe('z');
  });

  it('case-folds the kind so "FACTUAL" and "Factual" both work', () => {
    const r = parseDecomposeClaimsResponse(JSON.stringify({
      claims: [
        { label: 'a', sourceText: 'a', kind: 'FACTUAL' },
        { label: 'b', sourceText: 'b', kind: 'Evaluative' },
      ],
    }));
    expect(r.claims.map((c) => c.kind)).toEqual(['factual', 'evaluative']);
  });

  it('trims whitespace around label and sourceText', () => {
    const r = parseDecomposeClaimsResponse(JSON.stringify({
      claims: [{ label: '  hi  ', sourceText: '\n\nthere\n', kind: 'factual' }],
    }));
    expect(r.claims[0].label).toBe('hi');
    expect(r.claims[0].sourceText).toBe('there');
  });
});

describe('escapeTurtleLiteral', () => {
  it('escapes backslashes and double-quotes', () => {
    expect(escapeTurtleLiteral('he said "hi" \\o/'))
      .toBe('he said \\"hi\\" \\\\o/');
  });

  it('escapes newlines and tabs as Turtle escape sequences', () => {
    expect(escapeTurtleLiteral('a\nb\tc')).toBe('a\\nb\\tc');
  });
});
