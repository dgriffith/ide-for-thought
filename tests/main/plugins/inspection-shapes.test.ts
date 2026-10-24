/**
 * @vitest-environment node
 *
 * Inspections from plugins (#2642): an enabled plugin's `inspections/*.ttl`
 * are read into checks the sweep runs and Settings lists, each namespaced
 * by plugin; a bad file is refused on its own, naming why; and the list
 * follows the plugin scan, so turning a plugin off takes its checks away.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pluginInspectionFiles, pluginInspections } from '../../../src/main/plugins/inspection-shapes';
import { parseShapesFile } from '../../../src/main/graph/shacl/shapes';
import { _disablePluginsForTests, enablePlugins, reloadPluginScan } from '../../../src/main/plugins/registry';
import { setPluginEnabled } from '../../../src/main/plugins/lifecycle';
import { writePlugin } from '../../helpers/plugins';
import { silenceLogTags } from '../../helpers/quiet-logs';

silenceLogTags('plugins');

const READING_LIST = path.resolve(__dirname, '..', '..', 'fixtures', 'plugins', 'reading-list');
const SHAPE = (name: string, extra = '') => `@prefix sh: <http://www.w3.org/ns/shacl#> . @prefix ex: <https://example.org/s#> .
ex:${name} a sh:NodeShape ; sh:targetNode ex:x ; sh:name "${name}" ${extra}.`;

describe('pluginInspections (#2642)', () => {
  let tmp: string;
  let dir: string;
  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugin-inspections-')));
    dir = path.join(tmp, 'plugins');
    fs.mkdirSync(dir);
  });
  afterEach(() => {
    _disablePluginsForTests();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("lists the enabled plugins' checks, by plugin; a bad file is refused on its own", async () => {
    fs.cpSync(READING_LIST, path.join(dir, 'reading-list'), { recursive: true });
    writePlugin(dir, 'lab', { inspections: ['inspections/a.ttl', 'inspections/b.ttl', 'inspections/c.ttl'] }, {
      'inspections/a.ttl': 'not turtle {',
      'inspections/b.ttl': SHAPE('Writer', '; sh:sparql [ sh:select "INSERT DATA { <a:x> <a:p> 1 }" ] '),
      'inspections/c.ttl': SHAPE('Fine'),
    }, { name: 'Lab' });
    enablePlugins({ appVersion: '4.0.0', dir });
    await reloadPluginScan();
    const got = pluginInspections();
    expect(got.catalog.map((c) => [c.type, c.label, c.group, c.severity, c.plugin.name])).toEqual([
      ['plugin:lab/Fine', 'Fine', 'plugins', 'concern', 'Lab'],
      ['plugin:reading-list/FinishedWithoutDate', 'Finished books without a date', 'notes', 'info', 'Reading List'],
    ]);
    expect(got.problems).toEqual([
      { plugin: 'lab', file: 'inspections/a.ttl', problem: expect.stringMatching(/^it isn't valid Turtle/) },
      { plugin: 'lab', file: 'inspections/b.ttl', problem: 'a sh:select must be a SELECT query; a shape can only read the graph' },
    ]);
    expect(pluginInspectionFiles().map((f) => f.id)).toEqual(['plugin:lab/inspections/c.ttl', 'plugin:reading-list/inspections/finished-books.ttl']);
    expect(pluginInspections()).toBe(got); // memoized until the scan changes
  });

  it('refuses a shape another of the same plugin\'s files declared', async () => {
    writePlugin(dir, 'lab', { inspections: ['inspections/a.ttl', 'inspections/b.ttl'] }, {
      'inspections/a.ttl': SHAPE('Same'),
      'inspections/b.ttl': SHAPE('Same'),
    });
    enablePlugins({ appVersion: '4.0.0', dir });
    await reloadPluginScan();
    expect(pluginInspections().catalog.map((c) => c.type)).toEqual(['plugin:lab/Same']);
    expect(pluginInspections().problems).toEqual([{ plugin: 'lab', file: 'inspections/b.ttl', problem: 'the shape plugin:lab/Same is already declared in another of its files' }]);
  });

  it('turning the plugin off takes its checks away', async () => {
    fs.cpSync(READING_LIST, path.join(dir, 'reading-list'), { recursive: true });
    enablePlugins({ appVersion: '4.0.0', dir });
    await reloadPluginScan();
    expect(pluginInspections().catalog).toHaveLength(1);
    await setPluginEnabled(dir, 'reading-list', false);
    await reloadPluginScan();
    expect(pluginInspections().catalog).toEqual([]);
  });

  it("the scaffold's inspection (minerva plugin new --kind inspection) is a shapes file Minerva accepts", () => {
    const template = fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'src', 'main', 'plugins', 'scaffold-templates', 'kinds', 'inspection', 'inspections', 'untagged-notes.ttl'), 'utf-8');
    const read = parseShapesFile(template.replaceAll('__PLUGIN_ID__', 'my-checks'), { kind: 'plugin', id: 'my-checks', name: 'My Checks' });
    expect(read.ok && read.file.checks.map((c) => [c.type, c.group, c.severity])).toEqual([['plugin:my-checks/UntaggedNotes', 'notes', 'info']]);
  });

  it("none when plugins aren't enabled", () => {
    expect(pluginInspections()).toEqual({ files: [], catalog: [], problems: [] });
  });
});
