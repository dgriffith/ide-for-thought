/**
 * YAML frontmatter round-trip engine (#1596). This is the data-loss surface the
 * note Properties panel edits through, so the round-trip + edge cases are
 * pinned here: parse → typed rows, and mutate → reserialized block spliced back
 * by offset (comments/order/body preserved).
 */
import { describe, it, expect } from 'vitest';
import YAML from 'yaml';
import {
  parseFrontmatter,
  detectShape,
  applyFrontmatterMutation,
  type ParseResult,
} from '../../../src/shared/refactor/frontmatter-rows';

const fm = (body: string, rest = 'Body text.\n') => `---\n${body}\n---\n${rest}`;
/** Mutator that sets a key on the frontmatter map. */
const setKey = (key: string, value: unknown) => (doc: YAML.Document) => {
  if (YAML.isMap(doc.contents)) doc.set(key, value);
};

describe('parseFrontmatter', () => {
  it('reports no frontmatter for a plain note', () => {
    const r = parseFrontmatter('# Just a heading\n');
    expect(r.ok).toBe(true);
    expect('none' in r && r.none).toBe(true);
    if (r.ok) expect(r.rows).toEqual([]);
  });

  it('parses scalars into typed rows', () => {
    const r = parseFrontmatter(fm('title: Hello\ncount: 3\ndraft: true')) as ParseResult;
    expect(r.ok).toBe(true);
    expect(r.rows).toEqual([
      { key: 'title', shape: { kind: 'string', value: 'Hello' } },
      { key: 'count', shape: { kind: 'number', value: 3 } },
      { key: 'draft', shape: { kind: 'boolean', value: true } },
    ]);
  });

  it('detects ISO dates (as string or YAML date) and string-lists', () => {
    const r = parseFrontmatter(fm('due: 2026-08-02\ntags:\n  - a\n  - b')) as ParseResult;
    expect(r.rows[0]).toEqual({ key: 'due', shape: { kind: 'date', value: '2026-08-02' } });
    expect(r.rows[1]).toEqual({ key: 'tags', shape: { kind: 'string-list', value: ['a', 'b'] } });
  });

  it('detects wiki-links, with and without a display alias', () => {
    const r = parseFrontmatter(fm('a: "[[Note]]"\nb: "[[Note|Shown]]"')) as ParseResult;
    expect(r.rows[0]!.shape).toEqual({ kind: 'wiki-link', target: 'Note', display: null, raw: '[[Note]]' });
    expect(r.rows[1]!.shape).toEqual({ kind: 'wiki-link', target: 'Note', display: 'Shown', raw: '[[Note|Shown]]' });
  });

  it('renders a nested map / mixed list as an opaque yaml shape', () => {
    const r = parseFrontmatter(fm('meta:\n  x: 1\n  y: 2')) as ParseResult;
    expect(r.rows[0]!.shape.kind).toBe('yaml');
  });

  it('fails on a non-map document', () => {
    const r = parseFrontmatter(fm('just a bare string'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not a key\/value map/);
  });

  it('fails on malformed YAML rather than throwing', () => {
    const r = parseFrontmatter(fm('key: : : bad'));
    expect(r.ok).toBe(false);
  });

  it('handles CRLF line endings and reports block offsets', () => {
    const content = '---\r\ntitle: Hi\r\n---\r\nBody\r\n';
    const r = parseFrontmatter(content) as ParseResult;
    expect(r.ok).toBe(true);
    expect(r.rows[0]).toEqual({ key: 'title', shape: { kind: 'string', value: 'Hi' } });
    expect(content.slice(r.blockStart, r.blockEnd)).toBe('---\r\ntitle: Hi\r\n---\r\n');
  });
});

describe('detectShape edge cases', () => {
  it('treats a null scalar as an empty string (still editable)', () => {
    const r = parseFrontmatter(fm('empty:')) as ParseResult;
    expect(r.rows[0]!.shape).toEqual({ kind: 'string', value: '' });
  });
  it('does not mistake a plain 2026 title for a date', () => {
    expect(detectShape(new YAML.Scalar('The Year 2026'))).toEqual({ kind: 'string', value: 'The Year 2026' });
  });
});

describe('applyFrontmatterMutation', () => {
  it('sets a key and preserves the note body', () => {
    const next = applyFrontmatterMutation(fm('title: A'), setKey('draft', true));
    expect(next).toBe(fm('title: A\ndraft: true'));
  });

  it('preserves comments and key order through an edit', () => {
    const src = '---\n# leading comment\ntitle: A  # inline\nb: 2\n---\nBody.\n';
    const next = applyFrontmatterMutation(src, setKey('b', 3))!;
    expect(next).toContain('# leading comment');
    expect(next).toContain('# inline');
    expect(next).toContain('b: 3');
    expect(next.indexOf('title')).toBeLessThan(next.indexOf('b:')); // order kept
  });

  it('builds a fresh block when the note has no frontmatter yet', () => {
    const next = applyFrontmatterMutation('# Heading\n\nText.\n', setKey('title', 'New'));
    expect(next).toBe('---\ntitle: New\n---\n# Heading\n\nText.\n');
  });

  it('drops the whole block when the last key is deleted', () => {
    const del = (doc: YAML.Document) => { if (YAML.isMap(doc.contents)) doc.delete('only'); };
    const next = applyFrontmatterMutation(fm('only: 1', 'Body.\n'), del);
    expect(next).toBe('Body.\n'); // no empty `---\n\n---` left behind
  });

  it('keeps the block when deleting one of several keys', () => {
    const del = (doc: YAML.Document) => { if (YAML.isMap(doc.contents)) doc.delete('a'); };
    const next = applyFrontmatterMutation(fm('a: 1\nb: 2'), del);
    expect(next).toBe(fm('b: 2'));
  });

  it('no-ops (returns null) on malformed frontmatter rather than clobbering WIP', () => {
    expect(applyFrontmatterMutation(fm('key: : : bad'), setKey('x', 1))).toBeNull();
  });
});
