import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as dispatch from '../../../src/main/llm/apply-dispatch';
import {
  proposeWrite,
  approveProposal,
  rejectProposal,
  getProposal,
  _inFlightProposalUrisForTests,
} from '../../../src/main/llm/approval';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

// Wrap the real applyBundle in a spy so the tests can count applies (and inject
// a one-off failure) while every other call still does the real file + graph I/O.
vi.mock('../../../src/main/llm/apply-dispatch', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../src/main/llm/apply-dispatch')>();
  return { ...real, applyBundle: vi.fn(real.applyBundle) };
});

const applyBundle = vi.mocked(dispatch.applyBundle);

// #2361: two overlapping approve/reject calls for one proposal URI used to both
// pass the `pending` check and apply the bundle twice.
describe('approveProposal / rejectProposal per-URI in-flight guard (#2361)', () => {
  const project = useGraphProject('minerva-approval-inflight-');
  let ctx: ProjectContext;

  beforeEach(() => {
    ctx = project.ctx;
    applyBundle.mockClear();
  });

  async function proposeNote(name: string) {
    return proposeWrite(ctx, {
      operationType: 'new_claim',
      payloads: [{ kind: 'note', relativePath: `notes/${name}.md`, content: `# ${name}\n` }],
      note: 'test',
      proposedBy: 'unit-test',
    });
  }

  function notesOnDisk(): string[] {
    const dir = path.join(ctx.rootPath, 'notes');
    return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
  }

  it('Promise.all of two approves for one URI applies the bundle exactly once', async () => {
    const p = await proposeNote('once');

    const [a, b] = await Promise.all([approveProposal(ctx, p.uri), approveProposal(ctx, p.uri)]);

    expect(applyBundle).toHaveBeenCalledTimes(1);
    // A double apply would have filed a collision-suffixed `once-2.md`.
    expect(notesOnDisk()).toEqual(['once.md']);
    // The joining caller sees the real outcome, not a spurious failure.
    expect(a).toEqual({ ok: true, filedPaths: ['notes/once.md'], rewrittenPaths: [], renames: [] });
    expect(b).toEqual(a);
    expect((await getProposal(ctx, p.uri))?.status).toBe('approved');
    expect(_inFlightProposalUrisForTests(ctx)).toEqual([]);
  });

  it('an approve after the first has settled declines normally (no re-apply)', async () => {
    const p = await proposeNote('sequential');
    expect((await approveProposal(ctx, p.uri)).ok).toBe(true);
    expect((await approveProposal(ctx, p.uri)).ok).toBe(false);
    expect(applyBundle).toHaveBeenCalledTimes(1);
  });

  it('approve racing reject: approve wins, reject declines, status stays approved', async () => {
    const p = await proposeNote('approve-first');

    const [approved, rejected] = await Promise.all([
      approveProposal(ctx, p.uri),
      rejectProposal(ctx, p.uri),
    ]);

    expect(approved.ok).toBe(true);
    expect(rejected).toBe(false);
    expect(applyBundle).toHaveBeenCalledTimes(1);
    expect((await getProposal(ctx, p.uri))?.status).toBe('approved');
  });

  it('reject racing approve: reject wins, approve declines without applying', async () => {
    const p = await proposeNote('reject-first');

    const [rejected, approved] = await Promise.all([
      rejectProposal(ctx, p.uri),
      approveProposal(ctx, p.uri),
    ]);

    expect(rejected).toBe(true);
    expect(approved.ok).toBe(false);
    expect(applyBundle).not.toHaveBeenCalled();
    expect(notesOnDisk()).toEqual([]);
    expect((await getProposal(ctx, p.uri))?.status).toBe('rejected');
  });

  it('concurrent rejects both resolve to the single reject outcome', async () => {
    const p = await proposeNote('double-reject');
    const [a, b] = await Promise.all([rejectProposal(ctx, p.uri), rejectProposal(ctx, p.uri)]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect((await getProposal(ctx, p.uri))?.status).toBe('rejected');
  });

  it('a failed apply clears the in-flight entry, so a retry applies', async () => {
    const p = await proposeNote('retry');
    applyBundle.mockRejectedValueOnce(new Error('disk full'));

    // Both joined callers see the same failure; nothing was applied.
    const results = await Promise.allSettled([
      approveProposal(ctx, p.uri),
      approveProposal(ctx, p.uri),
    ]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(applyBundle).toHaveBeenCalledTimes(1);
    expect(_inFlightProposalUrisForTests(ctx)).toEqual([]);
    expect((await getProposal(ctx, p.uri))?.status).toBe('pending');

    const retry = await approveProposal(ctx, p.uri);
    expect(retry.ok).toBe(true);
    expect(applyBundle).toHaveBeenCalledTimes(2);
    expect(notesOnDisk()).toEqual(['retry.md']);
  });

  it('a reject queued behind a failed approve still rejects', async () => {
    const p = await proposeNote('fail-then-reject');
    applyBundle.mockRejectedValueOnce(new Error('boom'));

    const [approved, rejected] = await Promise.allSettled([
      approveProposal(ctx, p.uri),
      rejectProposal(ctx, p.uri),
    ]);
    expect(approved.status).toBe('rejected');
    expect(rejected).toEqual({ status: 'fulfilled', value: true });
    expect((await getProposal(ctx, p.uri))?.status).toBe('rejected');
  });

  it('different URIs are not serialized against each other', async () => {
    const p1 = await proposeNote('one');
    const p2 = await proposeNote('two');
    const [a, b] = await Promise.all([approveProposal(ctx, p1.uri), approveProposal(ctx, p2.uri)]);
    expect(a.ok && b.ok).toBe(true);
    expect(applyBundle).toHaveBeenCalledTimes(2);
    expect(notesOnDisk()).toEqual(['one.md', 'two.md']);
  });
});
