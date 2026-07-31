/**
 * Staleness guard for the bundled tutorial thoughtbase (#1545, epic #1518).
 *
 * The curated tutorial (`resources/tutorial-thoughtbase/`) teaches Minerva by
 * being Minerva — so if a feature evolves in a way that breaks the curated
 * content (a link that no longer resolves, a fence that no longer parses, the
 * `entrypoint` convention changing), the demo silently rots. This opens the
 * SHIPPED tree through the real indexer and asserts it's healthy, so that rot
 * fails CI here instead of in a user's first five minutes with the app (cf. the
 * help-corpus staleness snapshot).
 *
 * These are STRUCTURAL checks by design: they guard that the showcased features
 * still index, not that any particular note keeps its exact wording — editing
 * the curriculum shouldn't require editing this test.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexAllNotes, queryGraph } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import { tutorialResourceDir } from '../../../src/main/notebase/install-tutorial';
import { WIKI_LINK_RE, parseWikiInner } from '../../../src/shared/wiki-link';
import { resolveWikiLinkTarget } from '../../../src/shared/wiki-link-resolver';

// Guard the exact tree the installer ships (#1542 resolves the same dir in dev).
const SRC = tutorialResourceDir();

let root: string;
let ctx: ProjectContext;

/** Every `.md` note in the tree, project-relative (skips dotfiles/dirs). */
function listNotes(dir: string, base = ''): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(dir, base), { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listNotes(dir, rel));
    else if (e.name.endsWith('.md')) out.push(rel);
  }
  return out;
}

/** All fenced blocks of a given language across the tree, with their note path. */
function fencesOf(lang: string): Array<{ note: string; body: string }> {
  // Optional `{id=…}` cell attribute is same-line only; use [ \t]* (NOT \s*) so
  // it can't leak across the newline and swallow a JSON body that begins with `{`.
  const re = new RegExp('```' + lang + '(?:[ \\t]*\\{[^}]*\\})?\\n([\\s\\S]*?)```', 'g');
  const out: Array<{ note: string; body: string }> = [];
  for (const note of listNotes(root)) {
    const src = fs.readFileSync(path.join(root, note), 'utf-8');
    for (const m of src.matchAll(re)) out.push({ note, body: m[1]! });
  }
  return out;
}

beforeAll(async () => {
  // Copy to a temp dir first: initGraph/indexAllNotes write `.minerva/graph.ttl`
  // and search/vector indexes, which we don't want to dirty in `resources/`.
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tutorial-staleness-'));
  fs.cpSync(SRC, root, { recursive: true });
  ctx = projectContext(root);
  await initGraph(ctx);
  await indexAllNotes(ctx);
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('tutorial thoughtbase staleness guard (#1545)', () => {
  it('ships substantial content (an accidental mass deletion fails here)', () => {
    expect(listNotes(root).length).toBeGreaterThanOrEqual(10);
  });

  it('indexes under the canonical baseUri from the shipped config.json', async () => {
    const { results } = await queryGraph(ctx, `SELECT ?n WHERE { ?n a minerva:Note } LIMIT 1`);
    const iri = (results as Array<{ n: string }>)[0]?.n ?? '';
    expect(iri.startsWith('https://project.minerva.dev/minerva/tutorial/note/')).toBe(true);
  });

  it('has an `entrypoint`-tagged landing note (so install lands somewhere)', async () => {
    const { results } = await queryGraph(ctx, `
      SELECT ?title WHERE {
        ?n minerva:hasTag ?t ; dc:title ?title .
        FILTER(STRENDS(STR(?t), "tag/entrypoint"))
      }`);
    expect((results as Array<{ title: string }>).length).toBeGreaterThan(0);
  });

  it('has NO dangling wiki-links — every [[note]] target resolves', () => {
    const notes = listNotes(root).map(relativePath => ({ relativePath, isDirectory: false }));
    // Mirror the indexer: strip fenced + inline code before extracting links, so
    // syntax examples, mermaid `[[…]]` nodes, and JSON `[[` aren't seen as links.
    const stripCode = (s: string) => s.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
    const dangling: string[] = [];
    for (const { relativePath } of notes) {
      const body = stripCode(fs.readFileSync(path.join(root, relativePath), 'utf-8'));
      for (const m of body.matchAll(WIKI_LINK_RE)) {
        const { type, target } = parseWikiInner(m[1]!);
        if (type === 'cite' || type === 'quote') continue; // resolve to source/excerpt ids, not notes
        if (!resolveWikiLinkTarget(target, notes)) dangling.push(`${relativePath}: [[${m[1]}]]`);
      }
    }
    expect(dangling, `dangling wiki-links:\n${dangling.join('\n')}`).toEqual([]);
  });

  it('every ```output and ```vega-lite fence is valid JSON', () => {
    const bad: string[] = [];
    for (const { note, body } of [...fencesOf('output'), ...fencesOf('vega-lite')]) {
      try { JSON.parse(body.trim()); } catch (e) { bad.push(`${note}: ${(e as Error).message}`); }
    }
    expect(bad, `invalid JSON fences:\n${bad.join('\n')}`).toEqual([]);
  });

  it('the pre-ingested source + anchored excerpt still parse (Sources lesson)', async () => {
    const { results } = await queryGraph(ctx, `
      SELECT ?title ?cited WHERE {
        ?s minerva:sourceId "federalist-10" ; dc:title ?title .
        ?e thought:fromSource ?s ; thought:citedText ?cited .
      }`);
    const row = (results as Array<{ title: string; cited: string }>)[0];
    expect(row?.title, 'federalist-10 source did not index with a title').toBeTruthy();
    expect(row?.cited, 'no anchored excerpt indexed for the source').toBeTruthy();
  });

  it('embedded turtle indexes structured-reasoning objects (Structured Reasoning lesson)', async () => {
    const { results } = await queryGraph(ctx, `SELECT ?c WHERE { ?c a thought:Claim } LIMIT 1`);
    expect(results.length, 'no thought:Claim indexed from a ```turtle block').toBeGreaterThan(0);
  });

  it('typed links become graph edges (Links lesson) — at least one supports edge', async () => {
    const { results } = await queryGraph(ctx, `
      SELECT ?from ?to WHERE {
        ?from minerva:supports ?to .
        ?from a minerva:Note . ?to a minerva:Note .
      } LIMIT 1`);
    expect(results.length, 'no minerva:supports edge between notes').toBeGreaterThan(0);
  });
});
