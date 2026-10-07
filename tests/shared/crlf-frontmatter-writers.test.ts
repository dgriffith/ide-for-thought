/**
 * Every frontmatter writer keeps a CRLF note CRLF (#2690).
 *
 * The writers were all written against LF text: they rebuilt the block as
 * `---\n…\n---\n` and spliced it onto the body. On a CRLF note that either
 * didn't find the block at all (and wrote a SECOND one on top) or mixed `\n`
 * lines into a `\r\n` file. Each case here is a twin: the writer's result on
 * the CRLF note must be byte-for-byte its result on the LF note with every
 * `\n` spelled `\r\n` — which also proves no lone `\n` crept in, and that the
 * writer found the existing block rather than adding one.
 */
import { describe, it, expect } from 'vitest';
import { setFrontmatterProperty, getFrontmatterValues } from '../../src/shared/frontmatter-edit';
import { patchFrontmatterProperties, readFrontmatterProperties } from '../../src/shared/refactor/frontmatter-patch';
import {
  setPropertyInContent, removePropertyFromContent, extractPropertyKeysFromContent,
} from '../../src/shared/refactor/frontmatter-properties';
import { mergeTagsIntoContent, removeTagsFromContent, extractTagsFromContent } from '../../src/shared/refactor/auto-tag';
import { applyFrontmatterMutation, parseFrontmatter as parseRows } from '../../src/shared/refactor/frontmatter-rows';
import { applyBulkEdits } from '../../src/shared/objects/bulk-properties';
import { setGroupValue, groupValueOf } from '../../src/shared/objects/kanban-move';
import { mergeTagInContent } from '../../src/shared/refactor/merge-tag';
import { fillNoteWithReport } from '../../src/shared/objects/property-placeholders';
import { applyImageSize } from '../../src/shared/markdown/image-size';
import { applyObjectViewHeight } from '../../src/shared/objects/view-height';
import '../../src/shared/formatter/rules/yaml/yaml-key-sort';
import { formatContent } from '../../src/shared/formatter/engine';

const LF = [
  '---',
  'title: Kitchen Remodel',
  'type: project',
  '# a comment the span splicer must leave alone',
  'status: active',
  'tags: [home, ml]',
  '---',
  '# Kitchen Remodel',
  '',
  'Body with #ml and #ml/nlp inline.',
  '',
  'Address: {{address}}',
  '',
  '![plan](plan.png)',
  '',
  '```object-view',
  '{',
  '  "type": "task"',
  '}',
  '```',
  '',
].join('\n');
const CRLF = LF.replace(/\n/g, '\r\n');
const BOM = '\uFEFF';

const crlf = (s: string) => s.replace(/\n/g, '\r\n');

/** No `\n` that isn't the second half of a `\r\n`. */
function expectPureCrlf(s: string): void {
  const lone = [...s.matchAll(/(?<!\r)\n/g)].map((m) => m.index);
  expect(lone, 'offsets of lone \\n').toEqual([]);
}

/** Run `write` on both twins: the CRLF result is the LF result in CRLF, the
 *  LF result is a real change, and a byte-order mark stays in front. */
function twin(write: (content: string) => string | null): string {
  const lf = write(LF);
  expect(lf).not.toBeNull();
  expect(lf).not.toBe(LF);
  const out = write(CRLF);
  expect(out).toBe(crlf(lf!));
  expectPureCrlf(out!);
  expect(write(BOM + CRLF)).toBe(BOM + crlf(lf!));
  return out!;
}

describe('frontmatter writers keep a CRLF note CRLF (#2690)', () => {
  it('setFrontmatterProperty (the typed-property form, Set Type)', () => {
    const out = twin((c) => setFrontmatterProperty(c, 'type', 'book'));
    expect(out.match(/^---\r\n/gm)?.length).toBe(2); // the one block, rewritten — not a second one
    expect(getFrontmatterValues(CRLF).type).toBe('project');
  });

  it('setFrontmatterProperty clearing a key', () => {
    twin((c) => setFrontmatterProperty(c, 'status', null));
  });

  it('patchFrontmatterProperties (set_properties, type migration, tag merge)', () => {
    twin((c) => patchFrontmatterProperties(c, { status: 'done', due: '2026-02-01' }).content);
    expect(readFrontmatterProperties(CRLF).status).toBe('active');
  });

  it('setPropertyInContent / removePropertyFromContent (Add / Remove Property)', () => {
    twin((c) => setPropertyInContent(c, 'priority', 3).content);
    twin((c) => removePropertyFromContent(c, 'status').content);
    expect(extractPropertyKeysFromContent(CRLF)).toEqual(['title', 'type', 'status']);
  });

  it('mergeTagsIntoContent / removeTagsFromContent (auto-tag, Add / Remove Tag)', () => {
    twin((c) => mergeTagsIntoContent(c, ['renovation']).content);
    twin((c) => removeTagsFromContent(c, ['home']).content);
    expect(extractTagsFromContent(CRLF)).toEqual(['home', 'ml']);
  });

  it('applyFrontmatterMutation (the Properties panel)', () => {
    twin((c) => applyFrontmatterMutation(c, (doc) => { doc.set('status', 'paused'); }));
    const rows = parseRows(CRLF);
    expect(rows.ok && rows.rows.map((r) => r.key)).toEqual(['title', 'type', 'status', 'tags']);
  });

  it('applyBulkEdits (the bulk property editor) keeps the comment and every other line', () => {
    const out = twin((c) => applyBulkEdits(c, [
      { op: 'set', key: 'status', value: 'done' },
      { op: 'set', key: 'owner', value: 'Ada' },
    ])?.content ?? null);
    expect(out).toContain('\r\n# a comment the span splicer must leave alone\r\n');
  });

  it('setGroupValue (a Kanban move) changes only the grouping line', () => {
    const out = twin((c) => setGroupValue(c, 'status', 'done')?.content ?? null);
    expect(out).toBe(CRLF.replace('status: active\r\n', 'status: done\r\n'));
    expect(groupValueOf(out, 'status')).toBe('done');
    twin((c) => setGroupValue(c, 'status', null)?.content ?? null);
  });

  it('mergeTagInContent (Merge Tag): frontmatter tags: and inline #tags', () => {
    const out = twin((c) => mergeTagInContent(c, 'ml', 'machine-learning').content);
    expect(out).toContain('#machine-learning and #machine-learning/nlp');
  });

  it('fillNoteWithReport (property placeholders)', () => {
    twin((c) => setFrontmatterProperty(fillNoteWithReport(setFrontmatterProperty(c, 'address', '1 Main St'), ['address']).content, 'address', null));
  });

  it('formatContent (the formatter\'s YAML rules)', () => {
    const settings = { enabled: { 'yaml-key-sort': true }, configs: { 'yaml-key-sort': { priorityKeys: ['status'] } } };
    twin((c) => formatContent(c, settings));
  });

  it('builds a new block in the note\'s line ending when it has none', () => {
    const lfBody = '# No Frontmatter\n\ntext\n';
    const lf = setPropertyInContent(lfBody, 'type', 'idea').content;
    const out = setPropertyInContent(crlf(lfBody), 'type', 'idea').content;
    expect(out).toBe(crlf(lf));
    expect(setPropertyInContent(BOM + crlf(lfBody), 'type', 'idea').content).toBe(BOM + crlf(lf));
  });

  it('dropping the last key drops the block and keeps the body CRLF', () => {
    const note = '---\r\nstatus: active\r\n---\r\n\r\nbody\r\n';
    expect(removePropertyFromContent(note, 'status').content).toBe('body\r\n');
    expect(applyBulkEdits(note, [{ op: 'clear', key: 'status' }])?.content).toBe('\r\nbody\r\n');
  });

  it('leaves an LF note byte-identical to what it always produced', () => {
    expect(setPropertyInContent(LF, 'priority', 3).content).not.toContain('\r');
  });
});

describe('body rewrites on the same paths keep a CRLF note CRLF (#2690)', () => {
  const imageLine = LF.split('\n').indexOf('![plan](plan.png)') + 1;
  const fenceLine = LF.split('\n').indexOf('```object-view') + 1;

  it('applyImageSize (preview image resize)', () => {
    const ref = { line: imageLine, endLine: imageLine, label: 'plan', ordinal: 0, index: 0 };
    const out = twin((c) => applyImageSize(c, ref, { width: 400, height: null }));
    expect(out).toContain('![plan|400](plan.png)\r\n');
  });

  it('applyObjectViewHeight (preview view resize) — a pretty-printed spec gains a CRLF line', () => {
    const out = twin((c) => applyObjectViewHeight(c, fenceLine, 600));
    expect(out).toContain('"type": "task",\r\n  "height": 600\r\n}');
  });
});
