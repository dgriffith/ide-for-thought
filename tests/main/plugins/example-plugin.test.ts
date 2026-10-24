/**
 * @vitest-environment node
 *
 * The worked example in `docs/authoring-plugins.md` (#2632) is real:
 * - the manifest and files the doc shows are the fixture's, byte for byte;
 * - the fixture folder is an accepted plugin;
 * - each contributed file is one its seam parses — the skill and the type
 *   through their real parsers, the query run against a graph that has a
 *   Book Note in it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readPluginPackage } from '../../../src/main/plugins/package';
import { parseSkill } from '../../../src/main/skills/parse';
import { parseType } from '../../../src/main/types/parse';
import { indexAllNotes, queryGraphRows } from '../../../src/main/graph/index';
import { useGraphProject } from '../../helpers/temp-project';
import { parseShapesFile } from '../../../src/main/graph/shacl/shapes';
import { runShaclChecks } from '../../../src/main/graph/shacl/run';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'plugins', 'reading-list');
const DOC = fs.readFileSync(path.join(ROOT, 'docs', 'authoring-plugins.md'), 'utf-8');
const read = (rel: string) => fs.readFileSync(path.join(FIXTURE, rel), 'utf-8');
const APP_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')).version as string;

/** The fenced blocks in the doc's example section, by language. */
function exampleBlocks(lang: string): string[] {
  const section = DOC.slice(DOC.indexOf('## A complete example'));
  return [...section.matchAll(new RegExp('```' + lang + '\\n([\\s\\S]*?)```', 'g'))].map((m) => m[1]!);
}

describe('the authoring-plugins example (#2632)', () => {
  it('the doc shows the fixture\'s own manifest, type and query', () => {
    expect(exampleBlocks('json')).toEqual([read('plugin.json')]);
    expect(exampleBlocks('markdown')).toEqual([read('types/book-note.md')]);
    expect(exampleBlocks('sparql')).toEqual([read('queries/unread-books.rq')]);
    expect(exampleBlocks('turtle')).toEqual([read('inspections/finished-books.ttl')]);
  });

  it('is an accepted plugin', async () => {
    const r = await readPluginPackage(FIXTURE, APP_VERSION);
    if (!r.ok) throw new Error(r.error.problems.join('\n'));
    expect(r.plugin.provenance).toBe('plugin:reading-list@1.0.0');
    expect(r.plugin.contributions.map((c) => c.path).sort()).toEqual([
      'inspections/finished-books.ttl', 'queries/unread-books.rq', 'skills/reading-summary.md', 'types/book-note.md',
    ]);
  });

  it('its skill and its type parse', () => {
    const skill = parseSkill(read('skills/reading-summary.md'), 'plugin', 'skills/reading-summary.md', { readable: new Set(['summaryLength']), secret: new Set() });
    expect(skill.errors).toEqual([]);
    expect(skill.skill?.name).toBe('Reading Summary');
    const type = parseType(read('types/book-note.md'), 'user', 'book-note.md');
    expect(type.errors).toEqual([]);
    expect(type.type?.classLocalName).toBe('BookNote');
  });

  describe('its query', () => {
    const project = useGraphProject('minerva-plugin-example-');

    it('finds the unread Book Notes', async () => {
      const types = path.join(project.root, '.minerva', 'types');
      fs.mkdirSync(types, { recursive: true });
      fs.copyFileSync(path.join(FIXTURE, 'types', 'book-note.md'), path.join(types, 'book-note.md'));
      const note = (title: string, status: string) =>
        fs.writeFileSync(path.join(project.root, `${title}.md`), `---\ntitle: ${title}\ntype: book-note\nstatus: ${status}\n---\n`);
      note('Middlemarch', 'unread');
      note('Dune', 'finished');
      await indexAllNotes(project.ctx);
      const rows = await queryGraphRows(project.ctx, read('queries/unread-books.rq'));
      expect(rows.results.map((r) => r.title)).toEqual(['Middlemarch']);
    });
  });

  describe('its inspection (#2642)', () => {
    const project = useGraphProject('minerva-plugin-example-shapes-');

    it('flags a finished Book Note with no finished date, and nothing else', async () => {
      const types = path.join(project.root, '.minerva', 'types');
      fs.mkdirSync(types, { recursive: true });
      fs.copyFileSync(path.join(FIXTURE, 'types', 'book-note.md'), path.join(types, 'book-note.md'));
      const note = (title: string, extra: string) =>
        fs.writeFileSync(path.join(project.root, `${title}.md`), `---\ntitle: ${title}\ntype: book-note\n${extra}---\n`);
      note('Dune', 'status: finished\n');
      note('Middlemarch', 'status: finished\nfinished: 2026-05-01\n');
      note('Walden', 'status: reading\n');
      await indexAllNotes(project.ctx);
      const read2 = parseShapesFile(read('inspections/finished-books.ttl'), { kind: 'plugin', id: 'reading-list', name: 'Reading List' });
      if (!read2.ok) throw new Error(read2.problems.join('\n'));
      const found = await runShaclChecks(project.ctx, [read2.file], () => true);
      expect(found.map((f) => [f.type, f.message, f.notePath])).toEqual([
        ['plugin:reading-list/FinishedWithoutDate', '"Dune" is finished but has no finished date', 'Dune.md'],
      ]);
    });
  });
});
