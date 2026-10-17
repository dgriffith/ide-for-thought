/**
 * @vitest-environment node
 *
 * `plugin check` catches what it says it catches (#2654). Each case plants
 * one problem in an otherwise-good plugin and asserts the item that names it,
 * so a harness that quietly passes everything fails here.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkPlugin } from '../../../src/main/plugin-check/check';
import { runCli } from '../../../src/cli/run';
import { enablePlugins, disablePlugins } from '../../../src/main/plugins/registry';
import type { PluginCheckReport } from '../../../src/shared/plugins/check';
import { skillFile, typeFile, writePlugin } from '../../helpers/plugins';
import { silenceLogTags } from '../../helpers/quiet-logs';

silenceLogTags('plugins', 'graph', 'tables', 'config', 'mcp-servers');

let tmp: string;
beforeEach(() => { tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-check-'))); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const check = (folder: string, runServers = false) => checkPlugin(folder, { appVersion: '4.0.0', runServers, scratchParent: tmp });
const item = (r: PluginCheckReport, subject: string | RegExp) =>
  r.items.find((i) => (typeof subject === 'string' ? i.subject === subject : subject.test(i.subject)));
const src = () => path.join(tmp, 'src');

describe('plugin check (#2654)', () => {
  it('stops at a manifest Minerva would refuse, naming each problem', async () => {
    const folder = writePlugin(src(), 'lab', { skills: ['skills/missing.md'] }, {}, { extra: 1 });
    const r = await check(folder);
    expect(r.ok).toBe(false);
    expect(r.items.map((i) => i.stage)).toEqual(r.items.map(() => 'package'));
    expect(r.items.map((i) => i.detail).join('\n')).toMatch(/extra/);
  });

  it('fails an install Settings would refuse: a link inside the folder', async () => {
    const folder = writePlugin(src(), 'lab', { skills: ['skills/a.md'] }, { 'skills/a.md': skillFile('lab.a', 'A') });
    fs.symlinkSync('/etc/hosts', path.join(folder, 'hosts'));
    const r = await check(folder);
    expect(item(r, 'install')).toMatchObject({ status: 'fail', detail: expect.stringMatching(/holds a link/) });
  });

  it('fails a contribution its registry refuses, with the registry\'s reason', async () => {
    const folder = writePlugin(src(), 'lab', { 'object-types': ['types/bad.md'], themes: ['themes/t.json'] }, {
      'types/bad.md': '# no front matter at all\n',
      'themes/t.json': JSON.stringify({ label: 'T', base: 'dark', tokens: { '--nope': '#000' } }),
    });
    const r = await check(folder);
    expect(item(r, 'types/bad.md')).toMatchObject({ stage: 'contributions', status: 'fail', detail: expect.stringMatching(/missing YAML frontmatter/) });
    expect(item(r, 'themes/t.json')).toMatchObject({ status: 'fail', detail: expect.stringMatching(/--nope/) });
  });

  it('runs every saved query against the thoughtbases: a broken one fails, one reading past the tables is flagged', async () => {
    const folder = writePlugin(src(), 'lab', { 'saved-queries': ['queries/broken.rq', 'queries/peek.sql'] }, {
      'queries/broken.rq': '# @name Broken\nSELECT ?x WHERE { ?x',
      'queries/peek.sql': "# @name Peek\nSELECT * FROM read_csv('.minerva/secrets.json')",
    });
    const r = await check(folder);
    expect(item(r, 'query Broken × plain')).toMatchObject({ status: 'fail' });
    expect(item(r, 'query Peek × hostile')).toMatchObject({ status: 'warn', detail: expect.stringMatching(/not as a chart or query block/) });
  }, 60_000);

  it('types a note of each plugin type in each thoughtbase, and leaves no trace once removed', async () => {
    const folder = writePlugin(src(), 'lab', { 'object-types': ['types/specimen.md'] }, { 'types/specimen.md': typeFile('Specimen') });
    const r = await check(folder);
    expect(item(r, 'type specimen × plain')).toMatchObject({ status: 'pass' });
    expect(item(r, 'type specimen × hostile')).toMatchObject({ status: 'pass' });
    expect(item(r, 'remove')).toMatchObject({ stage: 'uninstall', status: 'pass' });
    expect(r.ok).toBe(true);
  });

  it('renders each skill for each note, and a thoughtbase the user names is checked from a copy', async () => {
    const mine = path.join(tmp, 'my-thoughtbase');
    fs.mkdirSync(mine);
    fs.writeFileSync(path.join(mine, 'n.md'), '# Mine\n');
    const folder = writePlugin(src(), 'lab', { skills: ['skills/a.md'] }, { 'skills/a.md': skillFile('lab.a', 'A', 'context: [fullNote]\n') });
    const r = await checkPlugin(folder, { appVersion: '4.0.0', thoughtbases: [mine], scratchParent: tmp });
    expect(item(r, 'skill lab.a × my-thoughtbase')).toMatchObject({ status: 'pass', detail: 'rendered for 1 note' });
    expect(fs.readdirSync(mine)).toEqual(['n.md']);
  });

  it('starts an MCP server only when asked, and fails one that won\'t start', async () => {
    const folder = writePlugin(src(), 'lab', {}, { 'server/x.js': 'process.exit(3);\n' }, {
      mcpServers: { x: { command: 'node', args: ['server/x.js'] } },
    });
    expect(item(await check(folder), 'server x')).toMatchObject({ status: 'skip', detail: expect.stringMatching(/pass --run-servers/) });
    expect(item(await check(folder, true), 'server x')).toMatchObject({ status: 'fail', detail: expect.stringMatching(/couldn't start it/) });
  }, 60_000);

  it('won\'t run where plugins are already loaded', async () => {
    enablePlugins({ appVersion: '4.0.0', dir: path.join(tmp, 'plugins') });
    try {
      await expect(check(src())).rejects.toThrow(/runs on its own/);
    } finally {
      disablePlugins();
    }
  });
});

describe('minerva plugin check (#2654)', () => {
  const cli = (...argv: string[]) => runCli(argv, { cwd: tmp, appVersion: '4.0.0' });

  it('prints the report, and exits 0 when nothing fails, 1 when something does', async () => {
    writePlugin(src(), 'good', { skills: ['skills/a.md'] }, { 'skills/a.md': skillFile('good.a', 'A') });
    const ok = await cli('plugin', 'check', 'src/good');
    expect(ok.code).toBe(0);
    expect(JSON.parse(ok.stdout)).toMatchObject({ plugin: 'good@1.0.0', ok: true });
    const bad = await cli('plugin', 'check', 'nowhere');
    expect(bad.code).toBe(1);
    expect(JSON.parse(bad.stdout)).toMatchObject({ ok: false, items: [{ stage: 'package', status: 'fail' }] });
  });

  it('takes --thoughtbase (repeatable) and --run-servers', async () => {
    const mine = path.join(tmp, 'mine');
    fs.mkdirSync(mine);
    fs.writeFileSync(path.join(mine, 'n.md'), '# n\n');
    writePlugin(src(), 'good', { skills: ['skills/a.md'] }, { 'skills/a.md': skillFile('good.a', 'A') });
    const r = await cli('plugin', 'check', 'src/good', '--thoughtbase', 'mine', `--thoughtbase=${mine}`, '--run-servers');
    expect(JSON.parse(r.stdout).items.filter((i: { subject: string }) => i.subject === 'skill good.a × mine')).toHaveLength(2);
  });

  it('needs exactly one folder', async () => {
    expect((await cli('plugin', 'check')).stderr).toMatch(/pass one plugin folder/);
    expect((await cli('plugin', 'check', 'a', 'b')).code).toBe(2);
    expect((await cli('plugin', 'frob')).stderr).toMatch(/the subcommands are/);
  });
});
