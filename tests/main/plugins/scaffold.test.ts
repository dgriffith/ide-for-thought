/**
 * @vitest-environment node
 *
 * `minerva plugin new --mcp node|python` (#2650). What it makes has to be a
 * plugin Minerva accepts, whose server Minerva's own registry can run, whose
 * skill is scoped to that server, and whose own test passes. Each of those is
 * checked against the real thing, for both runtimes: a real `node` and
 * `python3` process each time.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import semver from 'semver';
import {
  SCAFFOLD_KIND_POINTS,
  SCAFFOLD_MINERVA_RANGE,
  SCAFFOLD_RUNTIMES,
  scaffoldPluginFiles,
  writeScaffold,
} from '../../../src/main/plugins/scaffold';
import { readPluginPackage } from '../../../src/main/plugins/package';
import { _disablePluginsForTests, enablePlugins, getPluginScan, loadedPluginScan, reloadPluginScan } from '../../../src/main/plugins/registry';
import { savePluginSettings } from '../../../src/main/plugins/settings';
import { silenceLogTags } from '../../helpers/quiet-logs';

// The user's own servers file lives in the real home folder: keep it out.
vi.mock('../../../src/main/mcp-servers/config-store', () => ({
  getStoredServers: async () => [],
  addStoredServer: vi.fn(),
  removeStoredServer: vi.fn(),
  setStoredServerEnabled: vi.fn(),
  updateStoredServer: vi.fn(),
}));

import { callServerTool, listServerStatuses, reconcilePluginServers, setServerEnabled } from '../../../src/main/mcp-servers/registry';
import { configureMcpToolPermissionsPath } from '../../../src/main/mcp-servers/tool-permissions';
import { loadSkillCatalog } from '../../../src/main/skills/loader';
import { compileSkill } from '../../../src/main/skills/compile';
import { shutdownAllMcpClients } from '../../../src/main/mcp-client';
import { runCli } from '../../../src/cli/run';
import { PLUGIN_CONTRIBUTION_POINTS } from '../../../src/shared/plugins/format';
import { CitationRenderer } from '../../../src/main/publish/csl/renderer';
import { BUNDLED_LOCALES } from '../../../src/main/publish/csl/assets';

silenceLogTags('plugins', 'secrets', 'mcp-servers', 'mcp-confirm');

const APP_VERSION = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf-8')).version as string;
const HAS_PYTHON = spawnSync('python3', ['--version']).status === 0;

let tmp: string;
beforeEach(() => { tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-scaffold-'))); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('scaffoldPluginFiles (#2650)', () => {
  it.each([
    ['node', ['README.md', 'package.json', 'plugin.json', 'server/index.js', 'skills/memos.md', 'test/server.test.js']],
    ['python', ['README.md', 'plugin.json', 'server/server.py', 'skills/memos.md', 'tests/__init__.py', 'tests/test_server.py']],
  ] as const)('%s: a manifest, a server, a skill and a test', (runtime, files) => {
    const made = scaffoldPluginFiles({ id: 'my-tools', runtime });
    expect([...made.keys()]).toEqual(files);
    for (const text of made.values()) expect(text).not.toMatch(/__PLUGIN_(ID|NAME)__/);
    expect(JSON.parse(made.get('plugin.json')!)).toMatchObject({
      id: 'my-tools', name: 'My Tools', version: '0.1.0',
      mcpServers: { memos: { command: runtime === 'node' ? 'node' : 'python3', env: { MEMO_FILE: '${settings.memoFile}' } } },
    });
    expect(made.get('skills/memos.md')).toMatch(/^id: my-tools\.memos$/m);
  });

  it('takes a name, kept out of the JSON\'s way', () => {
    const made = scaffoldPluginFiles({ id: 'q', runtime: 'node', name: 'Quotes "and" \\slashes' });
    expect(JSON.parse(made.get('plugin.json')!).name).toBe('Quotes "and" \\slashes');
    expect(made.get('README.md')).toMatch(/^# Quotes "and" \\slashes$/m);
  });

  it.each([
    ['an id that isn\'t one', { id: 'My_Tools' }, /"id" must be lowercase letters and digits/],
    ['a name that\'s too long', { id: 'ok', name: 'x'.repeat(81) }, /"name"/],
  ])('refuses %s, in the manifest checker\'s words', (_what, opts, msg) => {
    expect(() => scaffoldPluginFiles({ runtime: 'node', ...opts })).toThrow(msg);
  });

  it('asks for a Minerva this one satisfies', () => {
    expect(semver.satisfies(APP_VERSION, SCAFFOLD_MINERVA_RANGE, { includePrerelease: true })).toBe(true);
  });
});

describe('writeScaffold (#2650)', () => {
  it('makes <dir>/<id>/, and won\'t touch one that exists', async () => {
    const { folder } = await writeScaffold(path.join(tmp, 'new', 'parent'), { id: 'my-tools', runtime: 'node' });
    expect(folder).toBe(path.join(tmp, 'new', 'parent', 'my-tools'));
    fs.writeFileSync(path.join(folder, 'server', 'index.js'), '// mine');
    await expect(writeScaffold(path.join(tmp, 'new', 'parent'), { id: 'my-tools', runtime: 'python' })).rejects.toThrow(/already exists/);
    expect(fs.readFileSync(path.join(folder, 'server', 'index.js'), 'utf-8')).toBe('// mine');
  });
});

describe.each(SCAFFOLD_RUNTIMES)('a %s scaffold, end to end (#2650)', (runtime) => {
  const skipPython = runtime === 'python' && !HAS_PYTHON;
  let dir: string;

  beforeEach(async () => {
    dir = path.join(tmp, 'plugins');
    await writeScaffold(dir, { id: 'memo-lab', runtime });
  });

  it('is a plugin Minerva accepts, contributing its skill and its server', async () => {
    const read = await readPluginPackage(path.join(dir, 'memo-lab'), APP_VERSION);
    expect(read.ok ? read.plugin.contributions.map((c) => c.path) : read.error.problems).toEqual(['skills/memos.md']);
    expect(read.ok && read.plugin.manifest.mcpServers?.map((s) => s.key)).toEqual(['memos']);
  });

  it.skipIf(skipPython)('its own test passes', () => {
    const folder = path.join(dir, 'memo-lab');
    const [cmd, args] = runtime === 'node' ? [process.execPath, ['--test']] : ['python3', ['-m', 'unittest']];
    expect(() => execFileSync(cmd, args, { cwd: folder, stdio: 'pipe', timeout: 60_000 })).not.toThrow();
  });

  describe('installed', () => {
    beforeEach(async () => {
      configureMcpToolPermissionsPath(path.join(tmp, 'mcp-tool-permissions.json'));
      enablePlugins({ appVersion: APP_VERSION, dir });
      await reloadPluginScan();
    });
    afterEach(async () => {
      _disablePluginsForTests();
      await reconcilePluginServers();
      await shutdownAllMcpClients();
    });

    it('its skill reaches only its own server', async () => {
      const { skills, errors } = await loadSkillCatalog(path.join(tmp, 'no-user-skills'), await getPluginScan());
      expect(errors.filter((e) => e.filePath.includes('memo-lab'))).toEqual([]);
      const skill = skills.find((s) => s.id === 'memo-lab.memos');
      expect(skill && compileSkill(skill).mcpScope).toEqual({ 'memo-lab.memos': null });
    });

    it.skipIf(skipPython)('turned on, it runs through Minerva\'s gate: the read-only tool freely, the other once allowed', async () => {
      const memoFile = path.join(tmp, 'memos.jsonl');
      await savePluginSettings(dir, loadedPluginScan().plugins[0]!.manifest, { memoFile });
      await setServerEnabled('plugin:memo-lab/memos', true);
      const status = (await listServerStatuses()).find((s) => s.id === 'plugin:memo-lab/memos');
      expect(status).toMatchObject({ status: 'connected' });
      expect(status!.tools.map((t) => [t.name, t.annotations?.readOnlyHint])).toEqual([['list_memos', true], ['add_memo', false]]);

      const text = (r: Awaited<ReturnType<typeof callServerTool>>) =>
        r.kind === 'called' ? (r.result.content[0] as { text: string }).text : r.reason;
      expect(text(await callServerTool('memo-lab.memos', 'list_memos', {}, null))).toBe('No memos yet.');
      expect(await callServerTool('memo-lab.memos', 'add_memo', { text: 'Buy milk' }, null)).toEqual({ kind: 'declined', reason: 'no-ui' });
      const allow = async () => ({ allow: true as const, remember: false });
      expect(text(await callServerTool('memo-lab.memos', 'add_memo', { text: 'Buy milk' }, allow))).toBe('Saved: Buy milk');
      expect(text(await callServerTool('memo-lab.memos', 'list_memos', {}, null))).toMatch(/^- Buy milk \(/);
      expect(fs.readFileSync(memoFile, 'utf-8')).toMatch(/"text":\s*"Buy milk"/);
    });
  });
});

describe('minerva plugin new (#2650)', () => {
  const cli = (...argv: string[]) => runCli(argv, { cwd: tmp });

  it('makes the folder and says what to do next', async () => {
    const r = await cli('plugin', 'new', 'my-tools', '--mcp', 'python', '--name', 'My Tools');
    expect(r).toMatchObject({ code: 0, stderr: '' });
    const out = JSON.parse(r.stdout);
    expect(out.folder).toBe(path.join(tmp, 'my-tools'));
    expect(out.files).toContain('server/server.py');
    expect(out.next[0]).toBe(`cd ${out.folder} && python3 -m unittest`);
    expect(fs.existsSync(path.join(tmp, 'my-tools', 'plugin.json'))).toBe(true);
  });

  it('takes --dir, and the = forms', async () => {
    const r = await cli('plugin', 'new', 'my-tools', '--mcp=node', `--dir=${path.join(tmp, 'work')}`);
    expect(r.code).toBe(0);
    expect(fs.existsSync(path.join(tmp, 'work', 'my-tools', 'server', 'index.js'))).toBe(true);
  });

  it.each([
    [['plugin'], /the subcommands are/],
    [['plugin', 'new'], /pass one plugin id/],
    [['plugin', 'new', 'a', 'b', '--mcp', 'node'], /pass one plugin id/],
    [['plugin', 'new', 'a'], /--kind must be skill, type, query, template, csl, theme, inspection, view, command, mcp \(or pass --mcp node\|python\)/],
    [['plugin', 'new', 'a', '--kind', 'widget'], /--kind must be skill, type/],
    [['plugin', 'new', 'a', '--mcp', 'ruby'], /--mcp must be node or python/],
    [['plugin', 'new', 'a', '--kind', 'mcp'], /--mcp must be node or python/],
    [['plugin', 'new', 'a', '--kind', 'skill', '--mcp', 'node'], /--mcp is for --kind mcp, not skill/],
    [['plugin', 'new', 'Bad_Id', '--mcp', 'node'], /"id" must be lowercase/],
  ])('%j is a usage error', async (argv, msg) => {
    const r = await cli(...argv);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(msg);
  });

  it('a folder it can\'t make is an error, not a usage error', async () => {
    fs.writeFileSync(path.join(tmp, 'a-file'), '');
    const r = await cli('plugin', 'new', 'x', '--mcp', 'node', '--dir', path.join(tmp, 'a-file'));
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/^Error: /);
  });

  it('refuses a folder that exists', async () => {
    fs.mkdirSync(path.join(tmp, 'taken'));
    const r = await cli('plugin', 'new', 'taken', '--mcp', 'node');
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/already exists/);
  });
});

describe('a declarative kind (#2653)', () => {
  it('every point a plugin can contribute to has a kind: a new point fails here until it does', () => {
    expect(Object.values(SCAFFOLD_KIND_POINTS).map((k) => k.point).sort()).toEqual(Object.keys(PLUGIN_CONTRIBUTION_POINTS).sort());
  });

  it.each([
    ['skill', ['README.md', 'plugin.json', 'skills/three-points.md'], { skills: ['skills/three-points.md'] }],
    ['type', ['README.md', 'plugin.json', 'types/my-tools-entry.md'], { 'object-types': ['types/my-tools-entry.md'] }],
    ['query', ['README.md', 'plugin.json', 'queries/tagged-notes.rq'], { 'saved-queries': ['queries/tagged-notes.rq'] }],
    ['template', ['README.md', 'plugin.json', 'templates/my-tools-note.md'], { 'note-templates': ['templates/my-tools-note.md'] }],
    ['csl', ['README.md', 'csl/my-tools.csl', 'plugin.json'], { 'csl-styles': ['csl/my-tools.csl'] }],
    ['theme', ['README.md', 'plugin.json', 'themes/my-tools-dark.json'], { themes: ['themes/my-tools-dark.json'] }],
  ] as const)('%s: one contribution, listed in the manifest', (kind, files, contributes) => {
    const made = scaffoldPluginFiles({ id: 'my-tools', kind });
    expect([...made.keys()]).toEqual(files);
    for (const text of made.values()) expect(text).not.toMatch(/__PLUGIN_(ID|NAME)__/);
    expect(JSON.parse(made.get('plugin.json')!)).toMatchObject({ id: 'my-tools', contributes });
  });

  it('escapes the name where it lands in JSON or XML', () => {
    const name = 'Ada\'s "<Tools>" & co';
    expect(JSON.parse(scaffoldPluginFiles({ id: 'q', kind: 'theme', name }).get('themes/q-dark.json')!).label).toBe(`${name} Dark`);
    expect(scaffoldPluginFiles({ id: 'q', kind: 'csl', name }).get('csl/q.csl')).toContain('<title>Ada\'s &quot;&lt;Tools&gt;&quot; &amp; co (author-date)</title>');
  });

  it('a language is only for mcp, and mcp needs one', () => {
    expect(() => scaffoldPluginFiles({ id: 'q', kind: 'mcp' })).toThrow(/needs a language/);
    expect(() => scaffoldPluginFiles({ id: 'q', kind: 'skill', runtime: 'node' })).toThrow(/only for an MCP plugin/);
  });

  it('the CLI makes one, and says to check it', async () => {
    const r = await runCli(['plugin', 'new', 'my-tools', '--kind=type'], { cwd: tmp });
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.files).toContain('types/my-tools-entry.md');
    expect(out.next[0]).toBe(`minerva plugin check ${path.join(tmp, 'my-tools')}`);
  });

  it('the CSL style renders a citation and a bibliography', () => {
    const style = scaffoldPluginFiles({ id: 'q', kind: 'csl' }).get('csl/q.csl')!;
    const renderer = new CitationRenderer(style, BUNDLED_LOCALES['en-US']!, new Map([
      ['a', { id: 'a', type: 'book', title: 'A Book', author: [{ family: 'Lovelace', given: 'Ada' }], issued: { 'date-parts': [[1843]] }, publisher: 'Taylor' }],
    ]), { outputFormat: 'text' });
    expect(renderer.renderCitation('a')).toBe('(Lovelace, 1843)');
    expect(JSON.stringify(renderer.renderBibliography())).toMatch(/Lovelace, A\. 1843\. .*A Book.*Taylor/);
  });
});
