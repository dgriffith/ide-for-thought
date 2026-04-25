import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  initGraph,
  indexNote,
  indexAllNotes,
  queryGraph,
  outgoingLinks,
} from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-cite-test-'));
}

function writeSourceMeta(root: string, id: string, ttl: string): void {
  const dir = path.join(root, '.minerva', 'sources', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.ttl'), ttl, 'utf-8');
}

const ARTICLE_TTL = `
this: a thought:Article ;
    dc:title "On the structure of knowledge graphs" ;
    dc:creator "Alice Smith" ;
    dc:issued "2023-07-15"^^xsd:date .
`;

describe('[[cite::source-id]] link (issue #91)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = mkTempProject();
    ctx = projectContext(root);
    await initGraph(ctx);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('writes a thought:cites edge from the note to the source URI', async () => {
    writeSourceMeta(root, 'smith-2023', ARTICLE_TTL);
    await indexAllNotes(ctx);

    const noteContent = '# My thoughts\n\nAs [[cite::smith-2023]] argues, knowledge graphs…';
    await indexNote(ctx, 'thoughts.md', noteContent);

    const { results } = await queryGraph(ctx, `
      SELECT ?src WHERE {
        ?note minerva:relativePath "thoughts.md" .
        ?note thought:cites ?src .
        ?src minerva:sourceId "smith-2023" .
      }
    `);
    expect(results).toHaveLength(1);
  });

  it('does not route cite targets through the note URI namespace', async () => {
    await indexNote(ctx, 'thoughts.md', 'See [[cite::smith-2023]].');

    const { results } = await queryGraph(ctx, `
      SELECT ?path WHERE {
        ?note minerva:relativePath "thoughts.md" .
        ?note thought:cites ?src .
        OPTIONAL { ?src minerva:relativePath ?path }
      }
    `);
    const row = (results as Array<{ path?: string }>)[0];
    expect(row).toBeDefined();
    expect(row.path).toBeUndefined();
  });

  it('uses thought:cites (not minerva:cites)', async () => {
    await indexNote(ctx, 'thoughts.md', 'See [[cite::smith-2023]].');

    const { results: withThought } = await queryGraph(ctx, `
      SELECT ?src WHERE {
        ?note minerva:relativePath "thoughts.md" .
        ?note thought:cites ?src .
      }
    `);
    expect(withThought).toHaveLength(1);

    const { results: withMinerva } = await queryGraph(ctx, `
      SELECT ?src WHERE {
        ?note minerva:relativePath "thoughts.md" .
        ?note minerva:cites ?src .
      }
    `);
    expect(withMinerva).toHaveLength(0);
  });

  it('reports cite links via outgoingLinks with linkType "cite"', async () => {
    writeSourceMeta(root, 'smith-2023', ARTICLE_TTL);
    await indexAllNotes(ctx);
    await indexNote(ctx, 'thoughts.md', 'See [[cite::smith-2023]].');

    const links = outgoingLinks(ctx, 'thoughts.md');
    const cite = links.find(l => l.linkType === 'cite');
    expect(cite).toBeDefined();
    expect(cite!.exists).toBe(true);
  });

  it('existing note-typed links (supports, references, …) still work', async () => {
    await indexNote(ctx, 'a.md', '# A\n\nClaim A.');
    await indexNote(ctx, 'b.md', '# B\n\n[[supports::a]] is the ground.');

    const { results } = await queryGraph(ctx, `
      SELECT ?target WHERE {
        ?note minerva:relativePath "b.md" .
        ?note minerva:supports ?target .
      }
    `);
    expect(results).toHaveLength(1);
  });
});
