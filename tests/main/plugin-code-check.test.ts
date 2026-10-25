/**
 * `plugin check`'s code stage (#2833), with the app's runtime faked: each
 * handler the plugin declares is called against each thoughtbase, a call the
 * broker refuses for an undeclared capability fails it, a refused scope or a
 * handler that fails on the sample inputs warns, and the registry and graph
 * the stage pointed at the scratch folder are put back. The real worker host
 * runs in `tests/e2e/cli-plugin-check-code.spec.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PluginRefusal } from '../../src/main/plugins/broker';
import type { PluginCode } from '../../src/shared/plugins/format';

const h = vi.hoisted(() => ({
  code: null as PluginCode | null,
  identity: true,
  tap: null as null | ((r: PluginRefusal) => void),
  log: [] as string[],
  command: vi.fn(),
  ingest: vi.fn(),
  exportIt: vi.fn(),
  inspect: vi.fn(),
}));
vi.mock('electron', () => ({ app: { whenReady: async () => { h.log.push('ready'); } } }));
vi.mock('../../src/main/plugin-protocol', () => ({ installPluginProtocol: () => { h.log.push('protocol'); } }));
vi.mock('../../src/main/security', () => ({ installGlobalWebContentsGuards: () => {}, installPermissions: () => {} }));
vi.mock('../../src/main/plugin-worker-host', () => ({
  setPluginRefusalTap: (t: typeof h.tap) => { h.tap = t; },
  stopStaleWorkerHosts: () => { h.log.push('hosts stopped'); },
}));
vi.mock('../../src/main/plugins/code-plugins', () => ({
  codePluginIdentity: () => (h.identity ? { id: 'lab', name: 'Lab', version: '1', capabilities: ['notes:read'] } : null),
  codePluginWorker: () => (h.code?.worker ?? null),
}));
vi.mock('../../src/main/plugins/registry', () => ({
  enablePlugins: (o: { dir: string }) => { h.log.push(`enable ${o.dir}`); },
  disablePlugins: () => { h.log.push('disable'); },
  reloadPluginScan: async () => {},
  loadedPluginScan: () => ({ plugins: h.code ? [{ manifest: { id: 'lab', code: h.code } }] : [] }),
}));
vi.mock('../../src/main/graph', () => ({
  initGraph: async (ctx: { rootPath: string }) => { h.log.push(`graph ${ctx.rootPath}`); },
  indexAllNotes: async () => {},
  disposeProject: (ctx: { rootPath: string }) => { h.log.push(`dispose ${ctx.rootPath}`); },
}));
vi.mock('../../src/main/graph/note-index', () => ({ indexedNotePaths: () => ['b.md', 'a.md', 'data.csv'] }));
vi.mock('../../src/main/plugin-commands', () => ({ runPluginCommand: h.command }));
vi.mock('../../src/main/plugin-ingestors', () => ({ ingestWithPlugin: h.ingest }));
vi.mock('../../src/main/plugin-exporters', () => ({ exportWithPlugin: h.exportIt }));
vi.mock('../../src/main/plugin-inspections', () => ({ runPluginInspection: h.inspect }));
vi.mock('../../src/main/publish/pipeline', () => ({ resolvePlan: async (_r: string, input: unknown) => ({ input }) }));

import { checkPluginCode, verdict } from '../../src/main/plugin-code-check';

const TBS = [{ name: 'tidy', root: '/s/tidy' }, { name: 'hostile', root: '/s/hostile' }];
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-code-check-'));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));
const input = { appVersion: '3.0.1', pluginsDir: '/s/plugins', pluginId: 'lab', thoughtbases: TBS, scratch };
const refuse = (code: PluginRefusal['code'], message: string) => h.tap!({ method: 'notes.write', code, message });

beforeEach(() => {
  h.code = { capabilities: ['notes:read'], api: '^1.0.0', worker: 'logic.js' };
  h.identity = true;
  h.log = [];
  for (const f of [h.command, h.ingest, h.exportIt, h.inspect]) f.mockReset();
});

describe('the code stage (#2833)', () => {
  it('calls each command handler on each thoughtbase, with the first note and a selection', async () => {
    h.code!.commands = [
      { id: 'sort', title: 'Sort', when: 'selection', run: { handler: 'sort' } },
      { id: 'steel', title: 'Steel', when: 'project', run: { skill: 'steelman' } },
    ];
    h.command.mockResolvedValue({ kind: 'result', replaceSelection: 'x' });
    const items = await checkPluginCode(input);
    expect(items).toEqual([
      { stage: 'code', subject: 'command sort × tidy', status: 'pass', detail: 'replaces the selection' },
      { stage: 'code', subject: 'command sort × hostile', status: 'pass', detail: 'replaces the selection' },
    ]);
    expect(h.command).toHaveBeenCalledWith('/s/tidy', 'lab', 'sort', { note: 'a.md', selection: 'Some words a command can work on.' });
    expect(h.log).toEqual(['ready', 'protocol', 'enable /s/plugins', 'graph /s/tidy', 'dispose /s/tidy', 'graph /s/hostile', 'dispose /s/hostile', 'disable', 'hosts stopped']);
  });

  it('fails a call past its capabilities, warns on a scope or a failure with sample inputs', async () => {
    h.code!.commands = [{ id: 'grab', title: 'Grab', when: 'note', run: { handler: 'grab' } }];
    h.command
      .mockImplementationOnce(async () => { refuse('capability', 'notes.write needs "notes:write".'); return { kind: 'result' }; })
      .mockImplementationOnce(async () => { throw new Error('Lab: the parser choked'); });
    const items = await checkPluginCode(input);
    expect(items.map((i) => [i.subject, i.status, i.detail])).toEqual([
      ['command grab × tidy', 'fail', 'it called outside what it declares: notes.write needs "notes:write".'],
      ['command grab × hostile', 'warn', 'with sample inputs, it failed: Lab: the parser choked'],
    ]);
    expect(h.tap).toBeNull();
  });

  it('runs an ingestor on a sample file, an exporter on a plan, and an inspection; skips views', async () => {
    h.code = {
      ...h.code!,
      views: [{ id: 'v', title: 'V', place: 'left-sidebar', entry: 'i.html', query: 'q.rq' }],
      ingestors: [{ id: 'srt', label: 'SRT', accepts: { extensions: ['.srt'] }, parse: { handler: 'p' } }],
      exporters: [{ id: 'epub', label: 'EPUB', input: 'html', scopes: ['single-note'], write: { handler: 'w' } }],
      inspections: [{ id: 'skip', label: 'Skip', description: 'd', severity: 'info', run: { handler: 'i' } }],
    };
    h.ingest.mockResolvedValue({ title: 'sample' });
    h.exportIt.mockResolvedValue({ files: [{ path: 'a.epub' }] });
    h.inspect.mockResolvedValueOnce([{ id: 'plugin:lab/skip-0' }]).mockResolvedValueOnce([{ id: 'plugin:lab/skip-failed', message: 'Lab\'s check didn\'t finish' }]);
    const items = await checkPluginCode({ ...input, thoughtbases: [TBS[0]!, TBS[1]!] });
    expect(items.map((i) => [i.subject, i.status, i.detail])).toEqual([
      ['views and live blocks', 'skip', 'they are drawn in a window: try them in the app'],
      ['ingestor srt × tidy', 'pass', 'made a source, "sample"'],
      ['exporter epub × tidy', 'pass', 'wrote 1 file'],
      ['inspection skip × tidy', 'pass', '1 finding'],
      ['ingestor srt × hostile', 'pass', 'made a source, "sample"'],
      ['exporter epub × hostile', 'pass', 'wrote 1 file'],
      ['inspection skip × hostile', 'warn', 'with sample inputs, it failed: Lab\'s check didn\'t finish'],
    ]);
    expect(h.exportIt).toHaveBeenCalledWith('lab', expect.objectContaining({ id: 'epub' }), { input: { kind: 'single-note', relativePath: 'a.md' } });
  });

  it("fails a plugin whose code didn't load, and passes logic with nothing to call", async () => {
    h.identity = false;
    expect(await checkPluginCode(input)).toEqual([{ stage: 'code', subject: 'code', status: 'fail', detail: 'its code didn\'t load, approved, in a plugins folder' }]);
    h.identity = true;
    expect(await checkPluginCode(input)).toEqual([{ stage: 'code', subject: 'logic', status: 'pass', detail: 'its logic loads; nothing it declares has a handler to call' }]);
    expect(h.log.at(-1)).toBe('hosts stopped');
  });
});

describe('verdict (#2833)', () => {
  it('a refused scope on a call that worked warns, naming it', () => {
    expect(verdict('command x', 'tidy', [{ method: 'notes.read', code: 'scope', message: '"b.md" is not one of the notes this view was given.' }], { ok: true, detail: 'ran' }))
      .toEqual({ stage: 'code', subject: 'command x × tidy', status: 'warn', detail: 'ran, but asked for notes it wasn\'t given: "b.md" is not one of the notes this view was given.' });
  });
});
