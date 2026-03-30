import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { MiniSearchProvider } from '../../../src/main/search/minisearch-provider';

function createProvider(): MiniSearchProvider {
  return new MiniSearchProvider();
}

describe('MiniSearchProvider', () => {
  describe('index and search', () => {
    it('finds an indexed document', () => {
      const p = createProvider();
      p.index('note.md', 'My Note', 'This is some content');
      const results = p.search('content');
      expect(results).toHaveLength(1);
      expect(results[0].relativePath).toBe('note.md');
    });

    it('finds by title', () => {
      const p = createProvider();
      p.index('note.md', 'Architecture', 'Body text');
      const results = p.search('Architecture');
      expect(results).toHaveLength(1);
    });

    it('title matches rank higher than content matches', () => {
      const p = createProvider();
      p.index('a.md', 'Architecture Overview', 'Some unrelated body');
      p.index('b.md', 'Other Note', 'The architecture is described here');
      const results = p.search('architecture');
      expect(results[0].relativePath).toBe('a.md');
    });

    it('supports prefix search', () => {
      const p = createProvider();
      p.index('note.md', 'Deployment', 'Deploy the application');
      const results = p.search('dep');
      expect(results.length).toBeGreaterThan(0);
    });

    it('returns empty for empty query', () => {
      const p = createProvider();
      p.index('note.md', 'Test', 'Content');
      expect(p.search('')).toEqual([]);
      expect(p.search('  ')).toEqual([]);
    });

    it('respects limit option', () => {
      const p = createProvider();
      for (let i = 0; i < 20; i++) {
        p.index(`note-${i}.md`, `Note ${i}`, 'Common content word');
      }
      const results = p.search('content', { limit: 5 });
      expect(results.length).toBeLessThanOrEqual(5);
    });
  });

  describe('update', () => {
    it('re-indexes a document on second index call', () => {
      const p = createProvider();
      p.index('note.md', 'Old Title', 'Old content');
      p.index('note.md', 'New Title', 'New content');
      const results = p.search('New Title');
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('New Title');
    });
  });

  describe('remove', () => {
    it('removes a document from search results', () => {
      const p = createProvider();
      p.index('note.md', 'Test', 'Content');
      p.remove('note.md');
      expect(p.search('Test')).toEqual([]);
    });

    it('is a no-op for non-existent document', () => {
      const p = createProvider();
      expect(() => p.remove('nonexistent.md')).not.toThrow();
    });
  });

  describe('clear', () => {
    it('empties all documents', () => {
      const p = createProvider();
      p.index('a.md', 'A', 'Content A');
      p.index('b.md', 'B', 'Content B');
      p.clear();
      expect(p.search('Content')).toEqual([]);
    });
  });

  describe('snippets', () => {
    it('includes context around the matched term', () => {
      const p = createProvider();
      const body = 'The quick brown fox jumps over the lazy dog. ' +
        'Architecture is the foundation of every system. ' +
        'More text follows after this point.';
      p.index('note.md', 'Test', body);
      const results = p.search('Architecture');
      expect(results[0].snippet).toContain('Architecture');
    });
  });

  describe('save and load', () => {
    it('round-trips through a file', async () => {
      const p = createProvider();
      p.index('note.md', 'Saved Note', 'Persistent content');

      const tmpFile = path.join(os.tmpdir(), `minisearch-test-${Date.now()}.json`);
      try {
        await p.save(tmpFile);

        const p2 = createProvider();
        await p2.load(tmpFile);
        const results = p2.search('Persistent');
        expect(results).toHaveLength(1);
        expect(results[0].relativePath).toBe('note.md');
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it('load handles missing file gracefully', async () => {
      const p = createProvider();
      await p.load('/tmp/nonexistent-file-' + Date.now() + '.json');
      expect(p.search('anything')).toEqual([]);
    });
  });
});
