/**
 * Proposals survive a full reindex (#1151, epic #1145 — Substrate).
 *
 * `indexAllNotes` rebuilds the graph store from scratch. Proposals aren't derived
 * from notes — they live only in graph.ttl and the live store — so the rebuild
 * must carry them across, or the review queue empties on every reindex and any
 * CLI/MCP-filed proposal is dropped before the user ever reviews it. This is the
 * last mile that makes external (fleet) proposals actually reach Minerva.
 */
import { describe, it, expect } from 'vitest';
import * as graph from '../../../src/main/graph/index';
import * as approval from '../../../src/main/llm/approval';
import { projectContext } from '../../../src/main/project-context-types';
import { useTempDir } from '../../helpers/temp-project';

describe('proposals survive indexAllNotes (#1151)', () => {
  const project = useTempDir('minerva-reindex-');

  it('a persisted proposal is still in the queue after an app-style reopen', async () => {
    const ctx = projectContext(project.root);

    // File a proposal (as the CLI/MCP propose path does) and persist to graph.ttl.
    await graph.initGraph(ctx);
    await graph.withLLMContext(() =>
      approval.proposeWrite(ctx, {
        operationType: 'component_creation',
        payloads: [{ kind: 'note', relativePath: 'x.md', content: '# X\n\nbody' }],
        note: 'from an external agent',
        proposedBy: 'mcp:claude-code',
      }),
    );
    await graph.persistGraph(ctx);
    graph.disposeProject(ctx);

    // Simulate an app open: initGraph (load snapshot) THEN indexAllNotes (rebuild).
    await graph.initGraph(ctx);
    await graph.indexAllNotes(ctx);

    const proposals = await approval.listProposals(ctx);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.proposedBy).toBe('mcp:claude-code');
    expect(proposals[0]!.status).toBe('pending');
  });

  it('a session proposal survives a manual rebuild (indexAllNotes again)', async () => {
    const ctx = projectContext(project.root);
    await graph.initGraph(ctx);
    await graph.indexAllNotes(ctx);
    await graph.withLLMContext(() =>
      approval.proposeWrite(ctx, {
        operationType: 'component_creation',
        payloads: [{ kind: 'note', relativePath: 'y.md', content: '# Y\n\nbody' }],
        note: 'session proposal',
        proposedBy: 'llm:conversation:abc',
      }),
    );
    // A manual "rebuild graph" must not silently drop the pending proposal.
    await graph.indexAllNotes(ctx);
    const proposals = await approval.listProposals(ctx);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.proposedBy).toBe('llm:conversation:abc');
  });
});
