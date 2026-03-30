import { describe, it, expect } from 'vitest';
import { sanitizeFilename, parseQueryContent, serializeQuery } from '../../src/main/saved-queries';

describe('sanitizeFilename', () => {
  it('lowercases and replaces special chars with hyphens', () => {
    expect(sanitizeFilename('My Cool Query!')).toBe('my-cool-query');
  });

  it('strips leading/trailing hyphens', () => {
    expect(sanitizeFilename('--test--')).toBe('test');
  });

  it('truncates to 60 characters', () => {
    const long = 'a'.repeat(100);
    expect(sanitizeFilename(long).length).toBeLessThanOrEqual(60);
  });

  it('handles spaces and mixed chars', () => {
    expect(sanitizeFilename('All Notes & Tags')).toBe('all-notes-tags');
  });
});

describe('parseQueryContent', () => {
  it('extracts @name from comment header', () => {
    const content = '# @name My Query\nSELECT * WHERE {}';
    const result = parseQueryContent(content, 'fallback-id', 'project');
    expect(result.name).toBe('My Query');
  });

  it('extracts @description', () => {
    const content = '# @name Test\n# @description A test query\nSELECT ?x WHERE {}';
    const result = parseQueryContent(content, 'id', 'project');
    expect(result.description).toBe('A test query');
  });

  it('uses id as name when @name is missing', () => {
    const content = 'SELECT * WHERE {}';
    const result = parseQueryContent(content, 'my-fallback', 'global');
    expect(result.name).toBe('my-fallback');
  });

  it('strips metadata comments from query body', () => {
    const content = '# @name Test\n# @description Desc\nSELECT ?x WHERE {}';
    const result = parseQueryContent(content, 'id', 'project');
    expect(result.query).toBe('SELECT ?x WHERE {}');
    expect(result.query).not.toContain('@name');
  });

  it('preserves scope', () => {
    const result = parseQueryContent('query', 'id', 'global');
    expect(result.scope).toBe('global');
  });
});

describe('serializeQuery', () => {
  it('includes @name header', () => {
    const result = serializeQuery('Test', '', 'SELECT ?x WHERE {}');
    expect(result).toContain('# @name Test');
  });

  it('includes @description when non-empty', () => {
    const result = serializeQuery('Test', 'A description', 'SELECT ?x');
    expect(result).toContain('# @description A description');
  });

  it('omits @description when empty', () => {
    const result = serializeQuery('Test', '', 'SELECT ?x');
    expect(result).not.toContain('@description');
  });

  it('round-trips with parseQueryContent', () => {
    const serialized = serializeQuery('My Query', 'Desc', 'SELECT ?x WHERE { ?x a ?y }');
    const parsed = parseQueryContent(serialized, 'id', 'project');
    expect(parsed.name).toBe('My Query');
    expect(parsed.description).toBe('Desc');
    expect(parsed.query).toBe('SELECT ?x WHERE { ?x a ?y }');
  });
});
