/**
 * propose_note_edits (#1816): anchored old_text → new_text replacements, so a
 * long note can be revised without the model re-emitting the whole file — the
 * wall #1749 hit. Everything downstream is the whole-file tool's: the same
 * before/after draft, card and `note-rewrite` approval path.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { executeNotebaseTool, type ToolCallbacks } from '../../../src/main/llm/tools';
import { applyAnchoredEdits } from '../../../src/main/llm/tools/propose-note-edits';
import { proposeWrite, approveProposal } from '../../../src/main/llm/approval';
import { indexNote, disposeProject } from '../../../src/main/graph/index';
import type { ConversationNoteBodyDraft } from '../../../src/shared/conversation-note-body-drafts';
import { makeGraphProject, type GraphProject } from '../../helpers/temp-project';

let root: string;
let project: GraphProject;
const ctx = () => project.ctx;
const toolCtx = () => ({ rootPath: root, conversationId: 'conv-1' });

async function seed(rel: string, body: string): Promise<void> {
  const abs = path.join(root, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, body, 'utf-8');
  await indexNote(ctx(), rel, body);
}
const read = (rel: string) => fsp.readFile(path.join(root, rel), 'utf-8');

function capture(): { calls: ConversationNoteBodyDraft[]; callbacks: ToolCallbacks } {
  const calls: ConversationNoteBodyDraft[] = [];
  return { calls, callbacks: { onNoteBodyDraft: (d) => calls.push(d) } };
}

const ESSAY = [
  '---', 'tags: [essay]', '---', '# On Mandolins', '',
  '## Opening', '', 'The mandolin is a small instrument. It is very small.', '',
  '## History', '', 'It came from Naples.', '',
  '## Closing', '', 'That is all.', '',
].join('\n');

beforeEach(async () => {
  project = await makeGraphProject('minerva-note-edits-tool-');
  root = project.root;
  await seed('notes/essay.md', ESSAY);
  await seed('notes/other.md', '# Other\n\nOld line.\n');
});
afterEach(async () => {
  disposeProject(ctx());
  await project.cleanup();
});

describe('propose_note_edits', () => {
  it('splices the edit into the current note, drafts before/after, and writes nothing', async () => {
    const { calls, callbacks } = capture();
    const out = await executeNotebaseTool(toolCtx(), 'propose_note_edits', {
      edits: [{ relative_path: 'notes/essay.md', old_text: 'It is very small.', new_text: 'Its body is a half-pear of ribs.' }],
      note: 'Tighten the opening',
    }, callbacks);

    expect(out.isError).toBe(false);
    expect(calls).toHaveLength(1);
    const [item] = calls[0]!.items;
    expect(item!.beforeContent).toBe(ESSAY);
    expect(item!.afterContent).toBe(ESSAY.replace('It is very small.', 'Its body is a half-pear of ribs.'));
    expect(calls[0]!.note).toBe('Tighten the opening');
    expect(await read('notes/essay.md')).toBe(ESSAY);
  });

  it('applies several edits to one note in order, and batches notes into ONE draft', async () => {
    const { calls, callbacks } = capture();
    const out = await executeNotebaseTool(toolCtx(), 'propose_note_edits', {
      edits: [
        { relative_path: 'notes/essay.md', old_text: 'It came from Naples.', new_text: 'It came from Naples, in the 1700s.' },
        // Anchors on the text the FIRST edit produced: edits apply in sequence.
        { relative_path: 'notes/essay.md', old_text: 'in the 1700s.', new_text: 'in the mid-1700s.' },
        { relative_path: 'notes/other.md', old_text: 'Old line.', new_text: 'New line.' },
      ],
    }, callbacks);

    expect(out.isError).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.items.map((i) => i.relativePath)).toEqual(['notes/essay.md', 'notes/other.md']);
    expect(calls[0]!.items[0]!.afterContent).toContain('It came from Naples, in the mid-1700s.');
    expect(calls[0]!.items[1]!.afterContent).toBe('# Other\n\nNew line.\n');
    expect(calls[0]!.note).toBe('Rewrite 2 notes');
  });

  it('inserts by anchoring on the preceding line, and deletes with an empty new_text', async () => {
    const { calls, callbacks } = capture();
    await executeNotebaseTool(toolCtx(), 'propose_note_edits', {
      edits: [
        { relative_path: 'notes/essay.md', old_text: '## History\n', new_text: '## History\n\nA new first paragraph.\n' },
        { relative_path: 'notes/essay.md', old_text: '## Closing\n\nThat is all.\n', new_text: '' },
      ],
    }, callbacks);
    const after = calls[0]!.items[0]!.afterContent;
    expect(after).toContain('## History\n\nA new first paragraph.\n\nIt came from Naples.');
    expect(after).not.toContain('Closing');
  });

  it('skips a whole note — never half-edits it — when one of its edits does not match', async () => {
    const { calls, callbacks } = capture();
    const out = await executeNotebaseTool(toolCtx(), 'propose_note_edits', {
      edits: [
        { relative_path: 'notes/essay.md', old_text: 'That is all.', new_text: 'Fin.' },
        { relative_path: 'notes/essay.md', old_text: 'this passage is not in the note', new_text: 'x' },
        { relative_path: 'notes/other.md', old_text: 'Old line.', new_text: 'New line.' },
      ],
    }, callbacks);

    expect(out.isError).toBe(false);
    // The essay is out entirely (its good first edit included); other.md stands.
    expect(calls[0]!.items.map((i) => i.relativePath)).toEqual(['notes/other.md']);
    expect(calls[0]!.warnings.join('\n')).toMatch(/notes\/essay\.md: old_text \(edit 2 of 2\) was not found verbatim/);
    expect(calls[0]!.warnings.join('\n')).toContain('No edits to this note were drafted');
  });

  it('refuses an ambiguous anchor and says how many places it matched', async () => {
    const { calls, callbacks } = capture();
    const out = await executeNotebaseTool(toolCtx(), 'propose_note_edits', {
      edits: [{ relative_path: 'notes/essay.md', old_text: 'small', new_text: 'tiny' }],
    }, callbacks);
    expect(out.isError).toBe(true);
    expect(calls).toHaveLength(0);
    expect(out.content).toMatch(/matches 2 places — include enough surrounding text/);
  });

  it('validates each edit and reports it rather than failing the batch', async () => {
    const { calls, callbacks } = capture();
    const out = await executeNotebaseTool(toolCtx(), 'propose_note_edits', {
      edits: [
        { relative_path: 'notes/essay.md', old_text: '', new_text: 'x' },
        { relative_path: 'notes/essay.md', old_text: 'Naples', new_text: 'Naples' },
        { relative_path: 'notes/missing.md', old_text: 'a', new_text: 'b' },
        { relative_path: 'notes/other.md', old_text: 'Old line.', new_text: 'New line.' },
      ],
    }, callbacks);
    expect(out.isError).toBe(false);
    expect(calls[0]!.items.map((i) => i.relativePath)).toEqual(['notes/other.md']);
    const w = calls[0]!.warnings.join('\n');
    expect(w).toContain('old_text is required');
    expect(w).toContain('old_text and new_text are identical');
    expect(w).toContain('notes/missing.md: no such note');
  });

  it('shares the agent-path guard with propose_note_body (#2453)', async () => {
    const { calls, callbacks } = capture();
    const out = await executeNotebaseTool(toolCtx(), 'propose_note_edits', {
      edits: [{ relative_path: '.minerva/config.json', old_text: '{', new_text: '{"x":1,' }],
    }, callbacks);
    expect(out.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('requires edits, and a conversation', async () => {
    expect((await executeNotebaseTool(toolCtx(), 'propose_note_edits', {}, capture().callbacks)).isError).toBe(true);
    const noConv = await executeNotebaseTool({ rootPath: root }, 'propose_note_edits', {
      edits: [{ relative_path: 'notes/other.md', old_text: 'Old line.', new_text: 'New line.' }],
    }, capture().callbacks);
    expect(noConv.isError).toBe(true);
    expect(noConv.content).toContain('requires a bound conversation id');
  });

  it('lands exactly the spliced text once the draft is approved — and only then', async () => {
    const { calls, callbacks } = capture();
    await executeNotebaseTool(toolCtx(), 'propose_note_edits', {
      edits: [{ relative_path: 'notes/essay.md', old_text: 'That is all.', new_text: 'Fin.' }],
    }, callbacks);
    // Filed the way CONVERSATION_FILE_NOTE_BODY_DRAFT files any note-body draft.
    const proposal = await proposeWrite(ctx(), {
      operationType: 'note_rewrite',
      payloads: calls[0]!.items.map((i) => ({ kind: 'note-rewrite' as const, path: i.relativePath, content: i.afterContent })),
      note: calls[0]!.note,
      proposedBy: 'unit-test',
    });
    expect(await read('notes/essay.md')).toBe(ESSAY);
    expect((await approveProposal(ctx(), proposal.uri)).ok).toBe(true);
    expect(await read('notes/essay.md')).toBe(ESSAY.replace('That is all.', 'Fin.'));
  });
});

describe('applyAnchoredEdits', () => {
  it('follows the note\'s CRLF line endings — a model writes \\n', () => {
    const r = applyAnchoredEdits('# T\r\n\r\nline one\r\nline two\r\n', [{ old_text: 'line one\nline two', new_text: 'only line' }]);
    expect(r).toEqual({ after: '# T\r\n\r\nonly line\r\n' });
  });

  it('writes new text with the note\'s line endings too', () => {
    const r = applyAnchoredEdits('a\r\nb\r\n', [{ old_text: 'b', new_text: 'b\nc' }]);
    expect(r).toEqual({ after: 'a\r\nb\r\nc\r\n' });
  });
});
