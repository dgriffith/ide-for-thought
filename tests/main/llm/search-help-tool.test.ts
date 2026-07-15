import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HelpSearchResult } from '../../../src/main/help-docs/search';

// The search/rank/weakMatch logic itself is exercised (with a real embedder)
// by tests/main/help-docs/search.test.ts. Here we isolate the tool's own
// responsibility — input validation, result formatting, and the WEAK MATCH
// prefix — from searchHelpDocs, which needs a corpus + embedder and would
// otherwise force these tests to touch the model.
const searchHelpDocsMock = vi.fn<(query: string, limit?: number) => Promise<HelpSearchResult>>();
vi.mock('../../../src/main/help-docs/search', async () => {
  const actual = await vi.importActual<typeof import('../../../src/main/help-docs/search')>(
    '../../../src/main/help-docs/search',
  );
  return { ...actual, searchHelpDocs: (query: string, limit?: number) => searchHelpDocsMock(query, limit) };
});

import { executeNotebaseTool } from '../../../src/main/llm/tools';

const hit = (id: string, score: number) => ({
  id, sourcePage: id, pageTitle: id, heading: 'Overview', text: `Help text for ${id}.`, score,
});

describe('search_help tool (#1286)', () => {
  beforeEach(() => { searchHelpDocsMock.mockReset(); });

  it('errors when query is missing', async () => {
    const out = await executeNotebaseTool({ rootPath: '/irrelevant' }, 'search_help', {});
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/query/);
    expect(searchHelpDocsMock).not.toHaveBeenCalled();
  });

  it('reports plainly when no corpus is available', async () => {
    searchHelpDocsMock.mockResolvedValue({ hits: [], weakMatch: true });
    const out = await executeNotebaseTool({ rootPath: '/irrelevant' }, 'search_help', { query: 'anything' });
    expect(out.isError).toBe(false);
    expect(out.content).toMatch(/no help docs|not available/i);
  });

  it('returns ranked hits with page, heading, and similarity score, passing the limit through', async () => {
    searchHelpDocsMock.mockResolvedValue({
      hits: [hit('notes-links.html', 0.62), hit('finance.html', 0.4)],
      weakMatch: false,
    });
    const out = await executeNotebaseTool({ rootPath: '/irrelevant' }, 'search_help', {
      query: 'wikilink syntax note',
      limit: 2,
    });
    expect(out.isError).toBe(false);
    expect(searchHelpDocsMock).toHaveBeenCalledWith('wikilink syntax note', 2);
    expect(out.content).toContain('notes-links.html');
    expect(out.content).toMatch(/similarity 0\.62/);
    expect(out.content.indexOf('notes-links.html')).toBeLessThan(out.content.indexOf('finance.html'));
    expect(out.content).not.toMatch(/^WEAK MATCH/);
  });

  it('prefixes a WEAK MATCH warning when the closest hit is below the confidence threshold', async () => {
    searchHelpDocsMock.mockResolvedValue({ hits: [hit('unrelated.html', 0.15)], weakMatch: true });
    const out = await executeNotebaseTool({ rootPath: '/irrelevant' }, 'search_help', {
      query: 'the boiling point of tungsten',
    });
    expect(out.isError).toBe(false);
    expect(out.content).toMatch(/^WEAK MATCH/);
    expect(out.content).toContain('unrelated.html');
  });

  it('clamps limit to the 1-20 range', async () => {
    searchHelpDocsMock.mockResolvedValue({ hits: [], weakMatch: true });
    await executeNotebaseTool({ rootPath: '/irrelevant' }, 'search_help', { query: 'x', limit: 999 });
    expect(searchHelpDocsMock).toHaveBeenCalledWith('x', 20);
  });
});
