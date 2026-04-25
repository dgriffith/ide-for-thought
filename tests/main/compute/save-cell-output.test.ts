import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { saveCellOutput } from '../../../src/main/compute/save-cell-output';
import { initGraph, indexNote, queryGraph } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-save-cell-output-test-'));
}

const SOURCE_NOTE = `# My analysis

Some prose.

\`\`\`sparql
SELECT ?n WHERE { ?n a minerva:Note }
\`\`\`

Trailing prose.
`;

describe('saveCellOutput (#244)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = mkTempProject();
    ctx = projectContext(root);
    await initGraph(ctx);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('writes a derived note + injects a cell id into the source fence', async () => {
    await fsp.writeFile(path.join(root, 'analysis.md'), SOURCE_NOTE, 'utf-8');

    const result = await saveCellOutput(root, {
      sourcePath: 'analysis.md',
      cellLanguage: 'sparql',
      cellCode: 'SELECT ?n WHERE { ?n a minerva:Note }',
      output: { type: 'text', value: 'result text' },
    });

    expect(result.injectedId).toBe(true);
    expect(result.cellId).toMatch(/^[a-f0-9]{8}$/);
    expect(result.derivedPath).toMatch(/^notes\/derived\/analysis-[a-f0-9]{8}\.md$/);

    // Source fence now carries `{id=…}`.
    const source = await fsp.readFile(path.join(root, 'analysis.md'), 'utf-8');
    expect(source).toContain(`\`\`\`sparql {id=${result.cellId}}`);

    // Derived note lands under notes/derived/ with frontmatter + backlink.
    const derived = await fsp.readFile(path.join(root, result.derivedPath), 'utf-8');
    expect(derived).toContain('derived_from: "[[analysis]]"');
    expect(derived).toContain(`derived_from_cell: "${result.cellId}"`);
    expect(derived).toMatch(new RegExp(`\\[\\[analysis#cell-${result.cellId}\\]\\]`));
  });

  it('reuses an existing cell id on re-save instead of minting a new one', async () => {
    const withId = SOURCE_NOTE.replace('```sparql', '```sparql {id=preexisting}');
    await fsp.writeFile(path.join(root, 'analysis.md'), withId, 'utf-8');

    const result = await saveCellOutput(root, {
      sourcePath: 'analysis.md',
      cellLanguage: 'sparql',
      cellCode: 'SELECT ?n WHERE { ?n a minerva:Note }',
      output: { type: 'text', value: 'x' },
    });

    expect(result.injectedId).toBe(false);
    expect(result.cellId).toBe('preexisting');
    // Source unchanged.
    const source = await fsp.readFile(path.join(root, 'analysis.md'), 'utf-8');
    expect(source).toBe(withId);
  });

  it('throws a clear error when the cell can’t be located in the source', async () => {
    await fsp.writeFile(path.join(root, 'analysis.md'), '# Empty note\n', 'utf-8');
    await expect(
      saveCellOutput(root, {
        sourcePath: 'analysis.md',
        cellLanguage: 'sparql',
        cellCode: 'SELECT 1',
        output: { type: 'text', value: '' },
      }),
    ).rejects.toThrow(/could not locate/i);
  });

  it('graph indexes derived_from frontmatter as prov:wasDerivedFrom pointing at the source note', async () => {
    await fsp.writeFile(path.join(root, 'analysis.md'), SOURCE_NOTE, 'utf-8');
    const { derivedPath } = await saveCellOutput(root, {
      sourcePath: 'analysis.md',
      cellLanguage: 'sparql',
      cellCode: 'SELECT ?n WHERE { ?n a minerva:Note }',
      output: {
        type: 'table',
        columns: ['name'],
        rows: [['alpha'], ['beta']],
      },
    });

    // Re-index source + derived notes so their frontmatter + links are in the graph.
    const sourceContent = await fsp.readFile(path.join(root, 'analysis.md'), 'utf-8');
    const derivedContent = await fsp.readFile(path.join(root, derivedPath), 'utf-8');
    await indexNote(ctx, 'analysis.md', sourceContent);
    await indexNote(ctx, derivedPath, derivedContent);

    const { results } = await queryGraph(ctx, `
      SELECT ?source WHERE {
        ?derived prov:wasDerivedFrom ?source .
      }
    `);
    const sourceIris = results.map((r) => (r as Record<string, string>).source);
    // The source IRI is the project-scoped note URI ending in `/note/<stem>`
    // — the indexer drops the .md extension when minting note URIs.
    expect(sourceIris.length).toBe(1);
    expect(sourceIris[0]).toMatch(/\/note\/analysis$/);
  });
});
