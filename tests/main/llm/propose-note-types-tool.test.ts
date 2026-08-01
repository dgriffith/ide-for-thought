/**
 * Type-inference migration (#1075): the `propose_note_types` tool files a PENDING
 * type proposal per untyped note (never a direct write — the trust guard would
 * trip under test), and approving it promotes the note by setting `type:`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexNote, queryGraph } from '../../../src/main/graph/index';
import { approveProposal } from '../../../src/main/llm/approval';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import { proposeNoteTypings } from '../../../src/main/llm/infer-types';
import { proposeNoteTypes } from '../../../src/main/llm/tools/propose-note-types';

let root: string;
let ctx: ProjectContext;

async function plant(rel: string, content: string): Promise<void> {
  const full = path.join(root, rel);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, content, 'utf-8');
  await indexNote(ctx, rel, content);
}
function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf-8');
}
async function pendingCount(): Promise<number> {
  const r = await queryGraph(ctx, `SELECT (COUNT(?p) AS ?n) WHERE { ?p a thought:Proposal ; thought:proposalStatus thought:pending }`);
  return Number((r.results as Array<{ n: string }>)[0]!.n);
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-infer-types-'));
  ctx = projectContext(root);
  await initGraph(ctx);
  // `book` is a stock type (author/isbn/…). Plant an untyped note that looks like one.
  await plant('Dune.md', `---\ntitle: Dune\nauthor: Frank Herbert\nisbn: "9780441172719"\n---\n# Dune\n`);
});
afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

describe('proposeNoteTypings (#1075)', () => {
  it('files a pending proposal and does NOT write the note (proposes, never applies)', async () => {
    const before = read('Dune.md');
    const result = await proposeNoteTypings(root, 'conv1', [{ relativePath: 'Dune.md', typeId: 'book' }], 'Inferred');
    expect(result.proposed).toEqual([{ relativePath: 'Dune.md', typeId: 'book' }]);
    expect(await pendingCount()).toBe(1);
    // Trust: nothing applied until approval — the file is untouched.
    expect(read('Dune.md')).toBe(before);
    expect(read('Dune.md')).not.toContain('type: book');
  });

  it('approving the proposal promotes the note (sets type:), leaving the body + keys intact', async () => {
    await proposeNoteTypings(root, 'conv1', [{ relativePath: 'Dune.md', typeId: 'book' }], 'Inferred');
    const { results } = await queryGraph(ctx, `SELECT ?p WHERE { ?p a thought:Proposal ; thought:proposalStatus thought:pending }`);
    const uri = (results as Array<{ p: string }>)[0]!.p;

    expect((await approveProposal(ctx, uri)).ok).toBe(true);
    const after = read('Dune.md');
    expect(after).toContain('type: book');
    expect(after).toContain('author: Frank Herbert'); // existing keys preserved
    expect(after).toContain('# Dune'); // body preserved
  });

  it('skips an unknown type — never invents one', async () => {
    const result = await proposeNoteTypings(root, 'conv1', [{ relativePath: 'Dune.md', typeId: 'wizard' }], 'x');
    expect(result.proposed).toEqual([]);
    expect(result.skipped[0]).toMatchObject({ relativePath: 'Dune.md', reason: expect.stringContaining('unknown type') });
    expect(await pendingCount()).toBe(0);
  });

  it('skips a missing note and a note already of that type', async () => {
    await plant('Typed.md', `---\ntitle: Typed\ntype: book\n---\n`);
    const result = await proposeNoteTypings(root, 'conv1', [
      { relativePath: 'Ghost.md', typeId: 'book' },
      { relativePath: 'Typed.md', typeId: 'book' },
    ], 'x');
    expect(result.proposed).toEqual([]);
    expect(result.skipped.map((s) => s.reason).join('|')).toMatch(/not found/);
    expect(result.skipped.map((s) => s.reason).join('|')).toMatch(/already type/);
  });
});

describe('propose_note_types tool (#1075)', () => {
  const convCtx = () => ({ rootPath: root, conversationId: 'conv1' });

  it('proposes via the tool and reports the count', async () => {
    const res = await proposeNoteTypes.run(convCtx(), { note: 'Migrate', assignments: [{ relativePath: 'Dune.md', typeId: 'book' }] }, {});
    expect(res.isError).toBe(false);
    const payload = JSON.parse(res.content);
    expect(payload.status).toBe('proposed');
    expect(payload.proposedCount).toBe(1);
    expect(await pendingCount()).toBe(1);
  });

  it('requires a bound conversation id', async () => {
    const res = await proposeNoteTypes.run({ rootPath: root }, { assignments: [{ relativePath: 'Dune.md', typeId: 'book' }] }, {});
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/conversation id/);
  });

  it('rejects a malformed bundle', async () => {
    const res = await proposeNoteTypes.run(convCtx(), { assignments: [] }, {});
    expect(res.isError).toBe(true);
  });

  it('is an error result when nothing could be proposed', async () => {
    const res = await proposeNoteTypes.run(convCtx(), { assignments: [{ relativePath: 'Dune.md', typeId: 'nope' }] }, {});
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/skipped/);
  });
});
