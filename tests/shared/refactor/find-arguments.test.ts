/**
 * Unit coverage for the pure shared piece of #409 / #410 — prompt
 * builders, JSON parser, claim-URI extractor, anti-flattery verdict.
 */

import { describe, it, expect } from 'vitest';
import {
  buildFindArgumentsSystemPrompt,
  buildFindArgumentsUserMessage,
  parseFindArgumentsResponse,
  extractClaimUri,
  escapeTurtleLiteral,
  ARGUMENT_STRENGTHS,
} from '../../../src/shared/refactor/find-arguments';

describe('buildFindArgumentsSystemPrompt', () => {
  it('embeds the support anti-flattery rule for support polarity', () => {
    const out = buildFindArgumentsSystemPrompt('support');
    expect(out).toMatch(/in favour of it/i);
    expect(out).toMatch(/Do NOT soften/i);
  });

  it('embeds the oppose anti-flattery rule for oppose polarity', () => {
    const out = buildFindArgumentsSystemPrompt('oppose');
    expect(out).toMatch(/against it/i);
    expect(out).toMatch(/Do NOT weaken the opposition/i);
  });

  it('asks for grounded citations and exposes the no-strong-arguments-found verdict', () => {
    const out = buildFindArgumentsSystemPrompt('support');
    expect(out).toContain('web_search');
    expect(out).toContain('no-strong-arguments-found');
  });

  it('lists every argument-strength bucket', () => {
    const out = buildFindArgumentsSystemPrompt('support');
    for (const s of ARGUMENT_STRENGTHS) {
      expect(out).toContain(`"${s}"`);
    }
  });
});

describe('buildFindArgumentsUserMessage', () => {
  it('includes the claim label verbatim', () => {
    const out = buildFindArgumentsUserMessage({
      polarity: 'support',
      claimLabel: 'Water boils at 100C at 1atm.',
    });
    expect(out).toContain('Water boils at 100C at 1atm.');
  });

  it('includes the source passage as a blockquote when supplied', () => {
    const out = buildFindArgumentsUserMessage({
      polarity: 'oppose',
      claimLabel: 'X.',
      claimSourceText: 'paragraph 1\nparagraph 2',
    });
    expect(out).toContain('> paragraph 1');
    expect(out).toContain('> paragraph 2');
  });

  it('uses the right verb per polarity', () => {
    expect(buildFindArgumentsUserMessage({ polarity: 'support', claimLabel: 'X' }))
      .toMatch(/support/i);
    expect(buildFindArgumentsUserMessage({ polarity: 'oppose', claimLabel: 'X' }))
      .toMatch(/rebut/i);
  });
});

describe('parseFindArgumentsResponse', () => {
  it('parses an arguments-found body with citations', () => {
    const body = JSON.stringify({
      verdict: 'arguments-found',
      summary: 'Two strong cases here.',
      arguments: [
        {
          label: 'Argument 1',
          structure: 'Because A, then B, then claim.',
          strength: 'strong',
          citations: [
            { url: 'https://example.com/a', snippet: 'Direct quote.' },
            { url: 'https://example.org/b', snippet: '' },
          ],
        },
      ],
    });
    const r = parseFindArgumentsResponse(body);
    expect(r.error).toBe('');
    expect(r.result?.verdict).toBe('arguments-found');
    expect(r.result?.arguments).toHaveLength(1);
    expect(r.result?.arguments[0].citations).toHaveLength(2);
    expect(r.result?.arguments[0].citations[0].url).toBe('https://example.com/a');
  });

  it('passes through the no-strong-arguments-found verdict (anti-flattery rule)', () => {
    const r = parseFindArgumentsResponse(JSON.stringify({
      verdict: 'no-strong-arguments-found',
      summary: '',
      arguments: [],
    }));
    expect(r.error).toBe('');
    expect(r.result?.verdict).toBe('no-strong-arguments-found');
    expect(r.result?.arguments).toEqual([]);
  });

  it('strips a ```json code fence', () => {
    const wrapped = '```json\n' + JSON.stringify({
      verdict: 'arguments-found',
      summary: 's',
      arguments: [{ label: 'a', structure: 'b', strength: 'moderate', citations: [] }],
    }) + '\n```';
    const r = parseFindArgumentsResponse(wrapped);
    expect(r.error).toBe('');
    expect(r.result?.arguments).toHaveLength(1);
  });

  it('returns an error for a non-JSON body', () => {
    const r = parseFindArgumentsResponse('totally not json');
    expect(r.result).toBeNull();
    expect(r.error).toMatch(/parse/i);
  });

  it('returns an error for an unknown verdict', () => {
    const r = parseFindArgumentsResponse(JSON.stringify({
      verdict: 'i-dunno',
      summary: '',
      arguments: [],
    }));
    expect(r.result).toBeNull();
    expect(r.error).toMatch(/verdict/i);
  });

  it('drops arguments with unknown strength', () => {
    const r = parseFindArgumentsResponse(JSON.stringify({
      verdict: 'arguments-found',
      summary: '',
      arguments: [
        { label: 'good', structure: 's', strength: 'strong', citations: [] },
        { label: 'bad', structure: 's', strength: 'pretty-good-actually', citations: [] },
      ],
    }));
    expect(r.error).toBe('');
    expect(r.result?.arguments).toHaveLength(1);
    expect(r.result?.arguments[0].label).toBe('good');
  });

  it('drops citations with non-http URLs', () => {
    const r = parseFindArgumentsResponse(JSON.stringify({
      verdict: 'arguments-found',
      summary: '',
      arguments: [
        {
          label: 'a',
          structure: 'b',
          strength: 'strong',
          citations: [
            { url: 'https://ok.com', snippet: '' },
            { url: 'javascript:alert(1)', snippet: '' },
            { url: 'mailto:x@y.com', snippet: '' },
            { url: 'gopher://nostalgia', snippet: '' },
          ],
        },
      ],
    }));
    expect(r.error).toBe('');
    expect(r.result?.arguments[0].citations).toHaveLength(1);
    expect(r.result?.arguments[0].citations[0].url).toBe('https://ok.com');
  });

  it('coerces an arguments-found verdict with all-malformed entries down to no-strong-arguments-found', () => {
    // The LLM said "found" but every entry was missing label/structure.
    // Treat that as the verdict the user actually wants to see.
    const r = parseFindArgumentsResponse(JSON.stringify({
      verdict: 'arguments-found',
      summary: 'tried but nothing landed',
      arguments: [
        { label: '', structure: 's', strength: 'strong', citations: [] },
        { label: 'a', structure: '', strength: 'strong', citations: [] },
      ],
    }));
    expect(r.error).toBe('');
    expect(r.result?.verdict).toBe('no-strong-arguments-found');
    expect(r.result?.summary).toBe('tried but nothing landed');
  });
});

describe('extractClaimUri', () => {
  it('finds an angle-bracketed claim URI on the line', () => {
    expect(extractClaimUri('something something <https://minerva.dev/c/claim-abc-123> trailing'))
      .toBe('https://minerva.dev/c/claim-abc-123');
  });

  it('finds a bare claim URI', () => {
    expect(extractClaimUri('cf https://minerva.dev/c/claim-xyz'))
      .toBe('https://minerva.dev/c/claim-xyz');
  });

  it('returns null when nothing matches', () => {
    expect(extractClaimUri('plain prose with no URI in sight')).toBeNull();
  });

  it('returns null for non-claim Minerva URIs', () => {
    expect(extractClaimUri('<https://minerva.dev/c/grounds-foo>')).toBeNull();
  });
});

describe('escapeTurtleLiteral', () => {
  it('escapes the usual suspects', () => {
    expect(escapeTurtleLiteral('a "b" \\c\nd\te'))
      .toBe('a \\"b\\" \\\\c\\nd\\te');
  });
});
