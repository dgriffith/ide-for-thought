/**
 * @vitest-environment node
 *
 * The example plugin, installed, end to end (#2633): its type is in the
 * thoughtbase's catalog with nothing in `.minerva/types/`, notes that use it
 * are typed in the graph, its query finds them, its skill is in the skill
 * catalog, and the graph's extension catalog attributes both to the plugin.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { indexAllNotes, queryGraphRows } from '../../../src/main/graph/index';
import { refreshExtensionContributions } from '../../../src/main/extension-contributions';
import { reloadSkillCatalog } from '../../../src/main/skills/loader';
import { _disablePluginsForTests, enablePlugins } from '../../../src/main/plugins/registry';
import { useGraphProject } from '../../helpers/temp-project';
import { silenceLogTags } from '../../helpers/quiet-logs';

// Saved queries' global folder needs Electron's app; that reader's entries are
// omitted, and logged, here.
silenceLogTags('project-context');

const FIXTURES = path.resolve(__dirname, '..', '..', 'fixtures', 'plugins');
const read = (rel: string) => fs.readFileSync(path.join(FIXTURES, 'reading-list', rel), 'utf-8');

describe('an installed plugin, end to end (#2633)', () => {
  const project = useGraphProject('minerva-plugin-loader-');

  beforeEach(() => { enablePlugins({ appVersion: '4.0.0', dir: FIXTURES }); });
  afterEach(async () => {
    _disablePluginsForTests();
    await reloadSkillCatalog(); // leave the shared catalog plugin-free for later files
  });

  it('types notes with the plugin\'s type, and its query finds them', async () => {
    fs.writeFileSync(path.join(project.root, 'Middlemarch.md'), '---\ntitle: Middlemarch\ntype: book-note\nstatus: unread\n---\n');
    fs.writeFileSync(path.join(project.root, 'Dune.md'), '---\ntitle: Dune\ntype: book-note\nstatus: finished\n---\n');
    expect(fs.existsSync(path.join(project.root, '.minerva', 'types'))).toBe(false);
    await indexAllNotes(project.ctx);
    const rows = await queryGraphRows(project.ctx, read('queries/unread-books.rq'));
    expect(rows.results.map((r) => r.title)).toEqual(['Middlemarch']);
  });

  it('its skill joins the app\'s skill catalog', async () => {
    const { skills } = await reloadSkillCatalog();
    expect(skills.find((s) => s.id === 'reading-list.reading-summary')).toMatchObject({
      source: 'plugin', plugin: { id: 'reading-list', name: 'Reading List', version: '1.0.0' },
    });
  });

  it('the graph attributes its contributions to the plugin, with its provenance', async () => {
    await reloadSkillCatalog();
    await refreshExtensionContributions(project.ctx);
    const rows = await queryGraphRows(project.ctx, `
      SELECT ?point ?id ?plugin ?provenance WHERE {
        ?c a minerva:Contribution ; minerva:contributesTo ?p ; dc:identifier ?id ; prov:wasAttributedTo ?a .
        ?p dc:identifier ?point .
        ?a a minerva:Plugin ; rdfs:label ?plugin ; dc:identifier ?provenance .
      } ORDER BY ?point`);
    expect(rows.results.filter((r) => r.plugin === 'Reading List')).toEqual([
      { point: 'object-types', id: 'book-note', plugin: 'Reading List', provenance: 'plugin:reading-list@1.0.0' },
      { point: 'skills', id: 'reading-list.reading-summary', plugin: 'Reading List', provenance: 'plugin:reading-list@1.0.0' },
    ]);
  });
});
