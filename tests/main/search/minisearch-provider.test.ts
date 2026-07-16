import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { MiniSearchProvider } from '../../../src/main/search/minisearch-provider';

// The provider reads note bodies from disk on demand for snippet extraction
// (perf #1111), so tests back each indexed note with a real file under a temp
// root. `write` both creates the file and indexes it, mirroring how the search
// layer feeds the provider (index.ts reads the file, then calls `index`).
let root: string;

function createProvider(): MiniSearchProvider {
  return new MiniSearchProvider(root);
}

function write(p: MiniSearchProvider, relativePath: string, title: string, content: string): void {
  const full = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
  p.index(relativePath, title, content);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minisearch-provider-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('MiniSearchProvider', () => {
  describe('index and search', () => {
    it('finds an indexed document', async () => {
      const p = createProvider();
      write(p, 'note.md', 'My Note', 'This is some content');
      const results = await p.search('content');
      expect(results).toHaveLength(1);
      expect(results[0].relativePath).toBe('note.md');
    });

    it('finds by title', async () => {
      const p = createProvider();
      write(p, 'note.md', 'Architecture', 'Body text');
      const results = await p.search('Architecture');
      expect(results).toHaveLength(1);
    });

    it('title matches rank higher than content matches', async () => {
      const p = createProvider();
      write(p, 'a.md', 'Architecture Overview', 'Some unrelated body');
      write(p, 'b.md', 'Other Note', 'The architecture is described here');
      const results = await p.search('architecture');
      expect(results[0].relativePath).toBe('a.md');
    });

    it('supports prefix search', async () => {
      const p = createProvider();
      write(p, 'note.md', 'Deployment', 'Deploy the application');
      const results = await p.search('dep');
      expect(results.length).toBeGreaterThan(0);
    });

    it('returns empty for empty query', async () => {
      const p = createProvider();
      write(p, 'note.md', 'Test', 'Content');
      expect(await p.search('')).toEqual([]);
      expect(await p.search('  ')).toEqual([]);
    });

    it('respects limit option', async () => {
      const p = createProvider();
      for (let i = 0; i < 20; i++) {
        write(p, `note-${i}.md`, `Note ${i}`, 'Common content word');
      }
      const results = await p.search('content', { limit: 5 });
      expect(results.length).toBeLessThanOrEqual(5);
    });
  });

  describe('update', () => {
    it('re-indexes a document on second index call', async () => {
      const p = createProvider();
      write(p, 'note.md', 'Old Title', 'Old content');
      write(p, 'note.md', 'New Title', 'New content');
      const results = await p.search('New Title');
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('New Title');
    });
  });

  describe('remove', () => {
    it('removes a document from search results', async () => {
      const p = createProvider();
      write(p, 'note.md', 'Test', 'Content');
      p.remove('note.md');
      expect(await p.search('Test')).toEqual([]);
    });

    it('is a no-op for non-existent document', () => {
      const p = createProvider();
      expect(() => p.remove('nonexistent.md')).not.toThrow();
    });
  });

  describe('clear', () => {
    it('empties all documents', async () => {
      const p = createProvider();
      write(p, 'a.md', 'A', 'Content A');
      write(p, 'b.md', 'B', 'Content B');
      p.clear();
      expect(await p.search('Content')).toEqual([]);
    });
  });

  describe('snippets', () => {
    it('includes context around the matched term', async () => {
      const p = createProvider();
      const body = 'The quick brown fox jumps over the lazy dog. ' +
        'Architecture is the foundation of every system. ' +
        'More text follows after this point.';
      write(p, 'note.md', 'Test', body);
      const results = await p.search('Architecture');
      expect(results[0].snippet).toContain('Architecture');
    });

    it('finds a match deep in the body (read from disk, not a truncated preview)', async () => {
      const p = createProvider();
      const body = 'x'.repeat(5000) + ' needle-in-haystack ' + 'y'.repeat(5000);
      write(p, 'note.md', 'Test', body);
      const results = await p.search('needle-in-haystack');
      expect(results[0].snippet).toContain('needle-in-haystack');
    });

    it('still surfaces a result (sans snippet) when the file is gone from disk', async () => {
      const p = createProvider();
      write(p, 'note.md', 'Test', 'Content about architecture');
      fs.rmSync(path.join(root, 'note.md'));
      const results = await p.search('architecture');
      expect(results).toHaveLength(1);
      expect(results[0].snippet).toBe('');
    });
  });

  describe('save and load', () => {
    it('round-trips through a file', async () => {
      const p = createProvider();
      write(p, 'note.md', 'Saved Note', 'Persistent content');

      const tmpFile = path.join(root, 'index.json');
      await p.save(tmpFile);

      const p2 = createProvider();
      await p2.load(tmpFile);
      const results = await p2.search('Persistent');
      expect(results).toHaveLength(1);
      expect(results[0].relativePath).toBe('note.md');
    });

    it('persisted JSON does not embed note bodies', async () => {
      const p = createProvider();
      write(p, 'note.md', 'Secret Title', 'UNIQUEBODYTOKEN should not be serialized');

      const tmpFile = path.join(root, 'index.json');
      await p.save(tmpFile);
      const written = fs.readFileSync(tmpFile, 'utf-8');
      // The inverted index holds terms, but the raw body text must not be
      // stored verbatim — that was the O(vault) duplication #1111 removed.
      expect(written).not.toContain('UNIQUEBODYTOKEN should not be serialized');
    });

    it('load handles missing file gracefully', async () => {
      const p = createProvider();
      await p.load(path.join(root, 'nonexistent.json'));
      expect(await p.search('anything')).toEqual([]);
    });
  });
});
