/**
 * @vitest-environment node
 *
 * The approval engine refuses a proposal that targets `.minerva/` or another
 * hidden folder — at propose time AND at apply time (#2453).
 *
 * Every tool that files a note-shaped proposal refuses such a path itself
 * (`tests/main/llm/prompt-injection/agent-paths.test.ts`). This is the layer
 * under them: a producer that forgets, or a proposal filed before the check
 * existed and still pending in `graph.ttl`, must not be able to write
 * Minerva's own state when the user clicks Approve.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { useGraphProject } from '../../helpers/temp-project';
import { approveProposal, proposeWrite, getProposal } from '../../../src/main/llm/approval';
import { applyBundle } from '../../../src/main/llm/apply-dispatch';
import { proposalUri, writeProposalToGraph } from '../../../src/main/llm/proposal-persistence';
import type { ProposalPayload } from '../../../src/main/llm/proposal-types';
import { AgentPathRefusedError } from '../../../src/main/path-containment';
import { fileNoteProposal } from '../../../src/main/llm/propose-note';

const project = useGraphProject('minerva-approval-agent-paths-');

function seed(): void {
  fs.mkdirSync(path.join(project.root, '.minerva', 'types'), { recursive: true });
  fs.mkdirSync(path.join(project.root, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(project.root, 'notes', 'a.md'), '# A\n');
  fs.writeFileSync(path.join(project.root, '.minerva', 'config.json'), '{"keep":true}');
  fs.symlinkSync(path.join(project.root, '.minerva'), path.join(project.root, 'notes', 'state'));
}

const HOSTILE: Array<[string, ProposalPayload]> = [
  ['note into .minerva/types', { kind: 'note', relativePath: '.minerva/types/evil.md', content: '---\nid: evil\n---\n' }],
  ['note through an in-root symlink', { kind: 'note', relativePath: 'notes/state/templates/evil.md', content: '# evil\n' }],
  ['note, upper-case spelling', { kind: 'note', relativePath: '.MINERVA/types/evil.md', content: '# evil\n' }],
  ['note, traversal spelling', { kind: 'note', relativePath: 'notes/../.minerva/types/evil.md', content: '# evil\n' }],
  ['note into .git', { kind: 'note', relativePath: '.git/hooks/pre-commit', content: 'rm -rf ~\n' }],
  ['rewrite of .minerva/config.json', { kind: 'note-rewrite', path: '.minerva/config.json', content: '{}' }],
  ['delete of .minerva/config.json', { kind: 'note-delete', path: '.minerva/config.json' }],
  ['move into .minerva', { kind: 'note-refactor', fromPath: 'notes/a.md', toPath: '.minerva/a.md' }],
  ['move out of .minerva', { kind: 'note-refactor', fromPath: '.minerva/config.json', toPath: 'notes/config.json' }],
  ['folder move of .minerva', { kind: 'folder-refactor', fromPath: '.minerva', toPath: 'notes/m' }],
  ['folder delete of the root', { kind: 'folder-delete', path: '.' }],
  ['folder delete of .minerva', { kind: 'folder-delete', path: '.minerva' }],
  ['source-meta with a path for an id', { kind: 'source-meta', sourceId: '../../notes', updates: [] } as unknown as ProposalPayload],
];

function untouched(): void {
  expect(fs.existsSync(path.join(project.root, '.minerva', 'types', 'evil.md'))).toBe(false);
  expect(fs.existsSync(path.join(project.root, '.minerva', 'templates', 'evil.md'))).toBe(false);
  expect(fs.existsSync(path.join(project.root, '.git'))).toBe(false);
  expect(fs.readFileSync(path.join(project.root, '.minerva', 'config.json'), 'utf-8')).toBe('{"keep":true}');
  expect(fs.readFileSync(path.join(project.root, 'notes', 'a.md'), 'utf-8')).toBe('# A\n');
}

describe('approval engine: no proposal writes a hidden folder (#2453)', () => {
  it.each(HOSTILE)('proposeWrite refuses %s', async (_label, payload) => {
    seed();
    await expect(proposeWrite(project.ctx, {
      operationType: 'component_creation',
      payloads: [payload],
      note: 'x',
      proposedBy: 'llm:test',
    })).rejects.toThrow(/Refused: |Invalid sourceId/);
    untouched();
  });

  it.each(HOSTILE)('applyBundle refuses %s, before any payload runs', async (_label, payload) => {
    seed();
    // An ordinary payload FIRST: the check runs over the whole bundle before
    // anything applies, so there is nothing to roll back.
    await expect(applyBundle(project.ctx, [
      { kind: 'note', relativePath: 'notes/fine.md', content: '# fine\n' },
      payload,
    ])).rejects.toThrow(/Refused: |Invalid sourceId/);
    expect(fs.existsSync(path.join(project.root, 'notes', 'fine.md'))).toBe(false);
    untouched();
  });

  it('a pending proposal filed before the check existed cannot be approved', async () => {
    seed();
    const uri = proposalUri();
    await writeProposalToGraph(project.ctx, {
      uri,
      status: 'pending',
      operationType: 'component_creation',
      payloads: [{ kind: 'note', relativePath: '.minerva/types/evil.md', content: '---\nid: evil\n---\n' }],
      note: 'legacy',
      affectsNodeUris: [],
      proposedBy: 'llm:legacy',
      proposedAt: new Date().toISOString(),
      autoExpires: new Date(Date.now() + 86_400_000).toISOString(),
    });
    await expect(approveProposal(project.ctx, uri)).rejects.toBeInstanceOf(AgentPathRefusedError);
    expect((await getProposal(project.ctx, uri))?.status).toBe('pending');
    untouched();
  });

  it('fileNoteProposal (MCP / CLI / substrate propose_note) answers with a refusal, filing nothing', async () => {
    seed();
    for (const rel of ['.minerva/types/evil.md', './.minerva/x.md', 'notes/state/x.md', '.MINERVA/x.md', '.', '../x.md']) {
      const r = await fileNoteProposal(project.ctx, { relativePath: rel, content: '# x\n', proposedBy: 'mcp:test' });
      expect(r.ok, rel).toBe(false);
      expect(r.ok ? '' : r.error, rel).toMatch(/^Refused: /);
    }
    const ok = await fileNoteProposal(project.ctx, { relativePath: 'notes/minerva-ideas.md', content: '# x\n', proposedBy: 'mcp:test' });
    expect(ok.ok).toBe(true);
    untouched();
  });

  it('ordinary proposals still file and apply', async () => {
    seed();
    const p = await proposeWrite(project.ctx, {
      operationType: 'component_creation',
      payloads: [{ kind: 'note', relativePath: 'notes/minerva-ideas.md', content: '# Minerva ideas\n' }],
      note: 'x',
      proposedBy: 'llm:test',
    });
    const r = await approveProposal(project.ctx, p.uri);
    expect(r.ok).toBe(true);
    expect(fs.readFileSync(path.join(project.root, 'notes', 'minerva-ideas.md'), 'utf-8')).toBe('# Minerva ideas\n');
  });
});
