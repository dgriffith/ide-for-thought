import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { assertSafePath, listFiles } from '../../../src/main/notebase/fs';

const FIXTURE_DIR = path.resolve(__dirname, '../../fixtures/sample-project');

describe('assertSafePath', () => {
  it('returns resolved path for a valid relative path', () => {
    const result = assertSafePath('/root', 'notes/test.md');
    expect(result).toBe(path.resolve('/root', 'notes/test.md'));
  });

  it('throws on path traversal with ../', () => {
    expect(() => assertSafePath('/root', '../outside.md')).toThrow('Path traversal');
  });

  it('throws on absolute path outside root', () => {
    expect(() => assertSafePath('/root', '/etc/passwd')).toThrow('Path traversal');
  });

  it('allows path resolving to root itself', () => {
    expect(() => assertSafePath('/root', '')).not.toThrow();
  });
});

describe('listFiles', () => {
  it('returns the fixture project structure', async () => {
    const files = await listFiles(FIXTURE_DIR);
    const names = files.map((f) => f.name);

    // Should have top-level dirs and README
    expect(names).toContain('notes');
    expect(names).toContain('research');
    expect(names).toContain('README.md');
  });

  it('sorts directories before files', async () => {
    const files = await listFiles(FIXTURE_DIR);
    const firstFile = files.findIndex((f) => !f.isDirectory);
    const lastDir = files.findLastIndex((f) => f.isDirectory);
    if (firstFile >= 0 && lastDir >= 0) {
      expect(lastDir).toBeLessThan(firstFile);
    }
  });

  it('ignores .minerva directory', async () => {
    const files = await listFiles(FIXTURE_DIR);
    const names = files.map((f) => f.name);
    expect(names).not.toContain('.minerva');
  });

  it('only includes .md and .ttl files', async () => {
    const files = await listFiles(FIXTURE_DIR);
    function checkLeaves(items: typeof files) {
      for (const f of items) {
        if (!f.isDirectory) {
          expect(f.name).toMatch(/\.(md|ttl)$/);
        }
        if (f.children) checkLeaves(f.children);
      }
    }
    checkLeaves(files);
  });

  it('includes nested files', async () => {
    const files = await listFiles(FIXTURE_DIR);
    const research = files.find((f) => f.name === 'research');
    expect(research?.isDirectory).toBe(true);
    const papers = research?.children?.find((f) => f.name === 'papers');
    expect(papers?.isDirectory).toBe(true);
    const lc = papers?.children?.find((f) => f.name === 'lambda-calculus.md');
    expect(lc).toBeDefined();
  });

  it('includes empty folders', async () => {
    const files = await listFiles(FIXTURE_DIR);
    const journal = files.find((f) => f.name === 'journal');
    expect(journal?.isDirectory).toBe(true);
    expect(journal?.children).toEqual([]);
  });
});
