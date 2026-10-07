/**
 * A CRLF note's frontmatter reaches the graph (#2690).
 *
 * The graph's frontmatter parse was LF-only, so a note saved with Windows
 * line endings indexed as if it had no frontmatter at all: no type, no tags,
 * no `title:`, no aliases, no typed properties — invisible to type views,
 * Kanban boards, the Tags panel and SPARQL — while the preview and the publish
 * pipeline read the same block. The test is a twin: the same note written LF
 * and CRLF must index to the same triples.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { indexAllNotes, queryGraph, getNoteTypedProperties } from '../../../src/main/graph/index';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

const LF_NOTE = [
  '---',
  'title: Meditations',
  'type: book',
  'tags: [stoicism, crlf-reading]',
  'aliases: [Ta eis heauton]',
  'rating: 4',
  'published: 2006-04-25',
  '---',
  '# A Heading That Is Not The Title',
  '',
  'Body text with an inline #inlinetag.',
  '',
].join('\n');
const CRLF_NOTE = LF_NOTE.replace(/\n/g, '\r\n');
const BOM_CRLF_NOTE = `\uFEFF${CRLF_NOTE}`;

const project = useGraphProject('minerva-line-endings-');
let ctx: ProjectContext;

function write(rel: string, content: string): void {
  const fp = path.join(project.root, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content, 'utf-8');
  // Same mtime on every twin, so `dc:modified` can't tell them apart.
  fs.utimesSync(fp, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
}

/** Every (predicate, object) on a note, with its `twin-*` folder spelled `X`
 *  so twins in different folders compare equal. */
async function triplesOf(rel: string): Promise<string[]> {
  const { results } = await queryGraph(ctx, `
    SELECT ?p ?o WHERE { ?n minerva:relativePath "${rel}" ; ?p ?o . }
  `);
  return (results as Array<{ p: string; o: string }>)
    .map((r) => `${r.p} ${String(r.o).replace(/twin-(?:lf|crlf|bom)/g, 'X')}`)
    .sort();
}

beforeEach(async () => {
  ctx = project.ctx;
  write('twin-lf/meditations.md', LF_NOTE);
  write('twin-crlf/meditations.md', CRLF_NOTE);
  write('twin-bom/meditations.md', BOM_CRLF_NOTE);
  await indexAllNotes(ctx);
});

describe('CRLF frontmatter in the graph (#2690)', () => {
  it('indexes a CRLF note to exactly the triples of its LF twin', async () => {
    const lf = await triplesOf('twin-lf/meditations.md');
    expect(lf.length).toBeGreaterThan(5);
    expect(await triplesOf('twin-crlf/meditations.md')).toEqual(lf);
  });

  it('does the same for a CRLF note behind a byte-order mark', async () => {
    expect(await triplesOf('twin-bom/meditations.md')).toEqual(await triplesOf('twin-lf/meditations.md'));
  });

  it('reads title:, type, tags, aliases and typed properties from the CRLF block', async () => {
    const { results } = await queryGraph(ctx, `
      SELECT ?title ?tag ?alias WHERE {
        ?n minerva:relativePath "twin-crlf/meditations.md" ; dc:title ?title ;
           minerva:hasTag/minerva:tagName ?tag ; minerva:hasAlias ?alias .
      }
    `);
    const rows = results as Array<{ title: string; tag: string; alias: string }>;
    expect([...new Set(rows.map((r) => r.title))]).toEqual(['Meditations']);
    expect([...new Set(rows.map((r) => r.tag))].sort()).toEqual(['crlf-reading', 'inlinetag', 'stoicism']);
    expect([...new Set(rows.map((r) => r.alias))]).toEqual(['Ta eis heauton']);

    const typed = await getNoteTypedProperties(ctx, 'twin-crlf/meditations.md');
    expect(typed.type?.id).toBe('book');
    const byName = Object.fromEntries(typed.properties.map((p) => [p.name, p.value]));
    expect(byName.rating).toBe('4');
    expect(byName.published).toBe('2006-04-25');
  });

  it('lists the CRLF note among the type\'s instances', async () => {
    const { results } = await queryGraph(ctx, `
      SELECT ?p WHERE { ?n a ?c ; minerva:relativePath ?p . ?c minerva:typeId "book" . } ORDER BY ?p
    `);
    expect((results as Array<{ p: string }>).map((r) => r.p)).toEqual([
      'twin-bom/meditations.md', 'twin-crlf/meditations.md', 'twin-lf/meditations.md',
    ]);
  });

  it('keeps no trailing \\r on any frontmatter value', async () => {
    const { results } = await queryGraph(ctx, `
      SELECT ?o WHERE { ?n minerva:relativePath "twin-crlf/meditations.md" ; ?p ?o . FILTER(isLiteral(?o)) }
    `);
    expect((results as Array<{ o: string }>).filter((r) => String(r.o).includes('\r'))).toEqual([]);
  });
});
