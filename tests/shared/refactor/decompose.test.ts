import { describe, it, expect } from 'vitest';
import {
  buildDecomposePrompt,
  parseDecomposeResponse,
} from '../../../src/shared/refactor/decompose';

describe('buildDecomposePrompt (issue #178)', () => {
  it('embeds the source title and body', () => {
    const p = buildDecomposePrompt({ sourceTitle: 'My Topic', sourceBody: 'Long note body.' });
    expect(p).toContain('My Topic');
    expect(p).toContain('Long note body.');
  });

  it('spells out the 2\u20137 children constraint and JSON shape', () => {
    const p = buildDecomposePrompt({ sourceTitle: '', sourceBody: '' });
    expect(p).toMatch(/2\u20137/);
    expect(p).toContain('"parent"');
    expect(p).toContain('"children"');
    expect(p).toContain('"title"');
    expect(p).toContain('"rationale"');
  });

  it('tells the LLM not to insert wiki-links in the parent content', () => {
    const p = buildDecomposePrompt({ sourceTitle: '', sourceBody: '' });
    expect(p).toMatch(/not.*wiki-links/i);
  });
});

describe('parseDecomposeResponse', () => {
  it('parses a bare JSON object with one parent and multiple children', () => {
    const raw = JSON.stringify({
      parent: { content: 'Index narrative.' },
      children: [
        { title: 'First', content: 'First body.', rationale: 'opens the topic' },
        { title: 'Second', content: 'Second body.', rationale: 'drills in' },
      ],
    });
    const { proposal, error } = parseDecomposeResponse(raw);
    expect(error).toBeUndefined();
    expect(proposal?.parent.content).toBe('Index narrative.');
    expect(proposal?.children).toHaveLength(2);
    expect(proposal?.children[0]).toEqual({
      title: 'First',
      content: 'First body.',
      rationale: 'opens the topic',
    });
  });

  it('tolerates markdown code fences and surrounding prose', () => {
    const inner = JSON.stringify({
      parent: { content: 'p' },
      children: [{ title: 'X', content: 'y', rationale: '' }],
    });
    const raw = 'Here you go:\n```json\n' + inner + '\n```\nDone.';
    const { proposal } = parseDecomposeResponse(raw);
    expect(proposal?.children[0].title).toBe('X');
  });

  it('drops children missing title or content', () => {
    const raw = JSON.stringify({
      parent: { content: 'p' },
      children: [
        { title: '', content: 'body' },
        { title: 'Only Title' },
        { title: 'Valid', content: 'valid body' },
      ],
    });
    const { proposal } = parseDecomposeResponse(raw);
    expect(proposal?.children).toHaveLength(1);
    expect(proposal?.children[0].title).toBe('Valid');
  });

  it('returns null when no valid children remain', () => {
    const raw = JSON.stringify({
      parent: { content: 'p' },
      children: [{ title: '', content: '' }],
    });
    const { proposal, error } = parseDecomposeResponse(raw);
    expect(proposal).toBeNull();
    expect(error).toBe('no-valid-children');
  });

  it('returns null for missing parent / children fields', () => {
    expect(parseDecomposeResponse('{"children": []}').proposal).toBeNull();
    expect(parseDecomposeResponse('{"parent": {}}').proposal).toBeNull();
    expect(parseDecomposeResponse('not JSON').proposal).toBeNull();
    expect(parseDecomposeResponse('[1, 2, 3]').proposal).toBeNull();
  });

  it('accepts missing rationale as empty string', () => {
    const raw = JSON.stringify({
      parent: { content: 'p' },
      children: [{ title: 'T', content: 'c' }],
    });
    const { proposal } = parseDecomposeResponse(raw);
    expect(proposal?.children[0].rationale).toBe('');
  });
});
