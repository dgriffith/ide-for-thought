/**
 * Editing one property rewrites only that property (#2737).
 *
 * The reporter's thoughtbase is under git and also written by scripts: flow
 * lists, long one-line values, empty values. Every frontmatter writer used to
 * re-serialise the whole block, so one edit touched every line. These tests
 * run each writer over awkward frontmatter and assert that every line outside
 * the edited key comes back byte for byte.
 */
import { describe, it, expect } from 'vitest';
import YAML from 'yaml';
import { spliceFrontmatter } from '../../../src/shared/refactor/frontmatter-splice';
import { applyFrontmatterMutation } from '../../../src/shared/refactor/frontmatter-rows';
import { setFrontmatterProperty } from '../../../src/shared/frontmatter-edit';
import { setPropertyInContent, removePropertyFromContent } from '../../../src/shared/refactor/frontmatter-properties';
import { mergeTagsIntoContent, removeTagsFromContent } from '../../../src/shared/refactor/auto-tag';
import { patchFrontmatterProperties } from '../../../src/shared/refactor/frontmatter-patch';
import { applyBulkEdits } from '../../../src/shared/objects/bulk-properties';

/** The "Before" block from the report, verbatim. */
const REPORT = [
  'type: meeting-note',
  'status: draft',
  'created: 2026-10-07',
  'tags: [meeting, project/alpha]',
  'source: Notes from the weekly sync with the vendor team, shared by email after the call on 2026-10-07',
  'owner:',
];

/** Everything the old writers mangled, on one block. */
const AWKWARD = [
  '# managed by sync.py — do not reorder',
  'type: meeting-note   # the kind',
  "status: 'draft'",
  'tags: [ padded, style ]',
  'aliases: ["Quoted One"]',
  'summary: >',
  '  folded block',
  '  scalar',
  'source: Notes from the weekly sync with the vendor team, shared by email after the call on 2026-10-07',
  'meta: {b: 1, a: 2}',
  'owner:',
];

const note = (lines: string[], body = 'Body\n') => `---\n${lines.join('\n')}\n---\n${body}`;

/** The block's lines, for line-level comparison. */
function blockLines(content: string): string[] {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!m) throw new Error(`no frontmatter in:\n${content}`);
  return m[1]!.split(/\r?\n/);
}

/** `after` equals `before` with exactly these line-level changes. */
function expectOnly(before: string[], after: string[], change: { replace?: [string, string]; add?: string; remove?: string }) {
  const expected = [...before];
  if (change.replace) expected[expected.indexOf(change.replace[0])] = change.replace[1];
  if (change.remove) expected.splice(expected.indexOf(change.remove), 1);
  if (change.add) expected.push(change.add);
  expect(after).toEqual(expected);
}

describe('every writer leaves untouched keys byte-identical (#2737)', () => {
  for (const [name, block] of [['the report', REPORT], ['awkward frontmatter', AWKWARD]] as const) {
    describe(name, () => {
      const status = block.find((l) => l.startsWith('status:'))!;
      // The edited key keeps its own style: `'draft'` becomes `'active'`.
      const active = status.includes("'") ? "status: 'active'" : 'status: active';

      it('Properties panel (applyFrontmatterMutation)', () => {
        const out = applyFrontmatterMutation(note(block), (doc) => { doc.set('status', 'active'); })!;
        expectOnly(block, blockLines(out), { replace: [status, active] });
        expect(out.endsWith('\n---\nBody\n')).toBe(true);
      });

      it('setting a type / typed form field (setFrontmatterProperty)', () => {
        const out = setFrontmatterProperty(note(block), 'status', 'active');
        expectOnly(block, blockLines(out), { replace: [status, active] });
      });

      it('Add Property (setPropertyInContent) — and no blank line is added before the body', () => {
        const { content, changed } = setPropertyInContent(note(block), 'reviewer', 'sam');
        expect(changed).toBe(true);
        expectOnly(block, blockLines(content), { add: 'reviewer: sam' });
        expect(content.endsWith('\n---\nBody\n')).toBe(true);
      });

      it('Remove Property (removePropertyFromContent)', () => {
        const { content, removed } = removePropertyFromContent(note(block), 'owner');
        expect(removed).toBe(true);
        expectOnly(block, blockLines(content), { remove: 'owner:' });
      });

      it('Add Tag (mergeTagsIntoContent) keeps the list a flow list, in its own padding', () => {
        const tags = block.find((l) => l.startsWith('tags:'))!;
        const { content, addedTags } = mergeTagsIntoContent(note(block), ['review']);
        expect(addedTags).toEqual(['review']);
        const after = blockLines(content);
        // Only the edited key is rewritten — and it stays a one-line flow list.
        expect(after.filter((l) => !l.startsWith('tags:'))).toEqual(block.filter((l) => l !== tags));
        expect(after.find((l) => l.startsWith('tags:'))).toMatch(/^tags: \[.*review\]$/);
      });

      it('Remove Tag (removeTagsFromContent)', () => {
        const tags = block.find((l) => l.startsWith('tags:'))!;
        const first = /\[\s*([^,\]]+)/.exec(tags)![1]!.trim();
        const { content, removedTags } = removeTagsFromContent(note(block), [first]);
        expect(removedTags).toEqual([first]);
        const after = blockLines(content);
        expect(after.filter((l) => !l.startsWith('tags:'))).toEqual(block.filter((l) => l !== tags));
        expect(after.find((l) => l.startsWith('tags:'))).toMatch(/^tags: \[[^\]]+\]$/);
      });

      it('LLM property patch (patchFrontmatterProperties)', () => {
        const { content, changedKeys } = patchFrontmatterProperties(note(block), { status: 'active', type: 'meeting-note' });
        // `type` was patched to the value it already had: reported unchanged, text untouched.
        expect(changedKeys).toEqual(['status']);
        expectOnly(block, blockLines(content), { replace: [status, active] });
      });

      it('bulk edits (applyBulkEdits)', () => {
        const out = applyBulkEdits(note(block), [{ op: 'set', key: 'status', value: 'active' }])!;
        expect(out.changed).toBe(true);
        expectOnly(block, blockLines(out.content), { replace: [status, active] });
      });
    });
  }
});

describe('spliceFrontmatter', () => {
  it('writes a changed key without padding or folding a long value', () => {
    const long = 'x '.repeat(80).trim();
    const out = spliceFrontmatter(note(['a: 1']), (doc) => { doc.set('tags', ['a', 'b']); doc.set('note', long); })!;
    expect(blockLines(out.content)).toEqual(['a: 1', 'tags:', '  - a', '  - b', `note: ${long}`]);
    expect(out.changedKeys).toEqual(['tags', 'note']);
  });

  it('returns the input itself when no value changed — including a nested map in another key order', () => {
    const content = note(AWKWARD);
    const out = spliceFrontmatter(content, (doc) => {
      doc.set('status', 'draft');
      doc.set('meta', doc.createNode({ a: 2, b: 1 }));
    })!;
    expect(out.content).toBe(content);
    expect(out.changedKeys).toEqual([]);
  });

  it('rewrites a multi-line value whole, in its own style, and keeps the comment above a key it removes', () => {
    const out = spliceFrontmatter(note(AWKWARD), (doc) => { doc.set('summary', 'short'); })!;
    // Still a folded block: the edited key's style is the user's, not yaml's.
    expect(blockLines(out.content)).toEqual([
      ...AWKWARD.slice(0, 5), 'summary: >-', '  short', ...AWKWARD.slice(8),
    ]);
    const removed = spliceFrontmatter(note(AWKWARD), (doc) => { doc.delete('type'); })!;
    expect(blockLines(removed.content)[0]).toBe('# managed by sync.py — do not reorder');
  });

  it('drops the block when the edit empties it', () => {
    expect(spliceFrontmatter(note(['a: 1'], '\nBody\n'), (doc) => { doc.delete('a'); })!.content).toBe('\nBody\n');
    expect(spliceFrontmatter(note(['a: 1'], '\nBody\n'), (doc) => { doc.delete('a'); }, { trimBodyOnDrop: true })!.content)
      .toBe('Body\n');
  });

  it('creates a block for a note without one, with an optional blank line before the body', () => {
    expect(spliceFrontmatter('Body\n', (doc) => { doc.set('a', 1); })!.content).toBe('---\na: 1\n---\nBody\n');
    expect(spliceFrontmatter('Body\n', (doc) => { doc.set('a', 1); }, { blankLineAfterNewBlock: true })!.content)
      .toBe('---\na: 1\n---\n\nBody\n');
    expect(spliceFrontmatter('Body\n', () => {})!.content).toBe('Body\n');
  });

  it('refuses malformed frontmatter by default, and replaces it when asked', () => {
    const broken = '---\na: [unclosed\n---\nBody\n';
    expect(spliceFrontmatter(broken, (doc) => { doc.set('a', 1); })).toBeNull();
    expect(spliceFrontmatter(broken, (doc) => { doc.set('a', 1); }, { onMalformed: 'replace' })!.content)
      .toBe('---\na: 1\n---\nBody\n');
  });

  it('edits an empty block', () => {
    expect(spliceFrontmatter('---\n\n---\nBody\n', (doc) => { doc.set('a', 1); })!.content).toBe('---\na: 1\n---\nBody\n');
  });

  it('keeps a CRLF note CRLF, with its byte-order mark, through a public writer', () => {
    const crlf = `\uFEFF${note(AWKWARD).replace(/\n/g, '\r\n')}`;
    const out = setFrontmatterProperty(crlf, 'status', 'active');
    expect(out.startsWith('\uFEFF---\r\n')).toBe(true);
    expect(out.replace(/\r\n/g, '')).not.toContain('\n');
    expectOnly(AWKWARD, blockLines(out), { replace: ["status: 'draft'", "status: 'active'"] });
  });

  it('round-trips the block as parsed: the result means what the edit said', () => {
    const out = setFrontmatterProperty(note(AWKWARD), 'status', 'active');
    const parsed = YAML.parse(blockLines(out).join('\n')) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      type: 'meeting-note', status: 'active', tags: ['padded', 'style'],
      summary: 'folded block scalar\n', meta: { a: 2, b: 1 }, owner: null,
    });
  });
});
