/**
 * @vitest-environment node
 *
 * `minerva plugin check` over every worked-example plugin (#2654), in
 * Minerva's own CI: each passes, servers started, against the built-in
 * fixtures and the full hostile thoughtbase from `tests/helpers/`. A
 * regression in any seam a plugin reaches (or in the examples themselves)
 * shows up here as a failed item, by name.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkPlugin } from '../../../src/main/plugin-check/check';
import { writeScaffold } from '../../../src/main/plugins/scaffold';
import { ALL_HOSTILE_FEATURES, buildHostileThoughtbase, restoreHostilePermissions, type HostileManifest } from '../../helpers/hostile-thoughtbase';
import { silenceLogTags } from '../../helpers/quiet-logs';

silenceLogTags('plugins', 'graph', 'tables', 'watcher', 'config', 'mcp-servers', 'project-context');

const APP_VERSION = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf-8')).version as string;
const EXAMPLES = path.resolve(__dirname, '../../fixtures/plugins');

let tmp: string;
let hostile: HostileManifest;
beforeAll(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-check-examples-')));
  fs.mkdirSync(path.join(tmp, 'outside'));
  hostile = buildHostileThoughtbase(path.join(tmp, 'hostile'), { outside: path.join(tmp, 'outside'), features: ALL_HOSTILE_FEATURES });
});
afterAll(() => {
  restoreHostilePermissions(hostile);
  fs.rmSync(tmp, { recursive: true, force: true });
});

const failures = (r: Awaited<ReturnType<typeof checkPlugin>>) => r.items.filter((i) => i.status === 'fail');

describe('every worked-example plugin passes plugin check (#2654)', () => {
  it.each(fs.readdirSync(EXAMPLES).filter((n) => fs.statSync(path.join(EXAMPLES, n)).isDirectory()))('%s', async (name) => {
    const r = await checkPlugin(path.join(EXAMPLES, name), { appVersion: APP_VERSION, runServers: true, thoughtbases: [hostile.root], scratchParent: tmp });
    expect(failures(r)).toEqual([]);
    expect(r.ok).toBe(true);
    for (const stage of ['package', 'contributions', 'uninstall'] as const) {
      expect(r.items.some((i) => i.stage === stage && i.status === 'pass'), stage).toBe(true);
    }
  }, 120_000);

  it.each(['node', 'python'] as const)('and so does a fresh %s scaffold (#2650)', async (runtime) => {
    const { folder } = await writeScaffold(path.join(tmp, `scaffold-${runtime}`), { id: 'memo-lab', runtime });
    const r = await checkPlugin(folder, { appVersion: APP_VERSION, runServers: true, scratchParent: tmp });
    expect(failures(r)).toEqual([]);
    expect(r.items.filter((i) => i.stage === 'mcp').map((i) => [i.subject, i.detail?.split(':')[0]])).toEqual([
      ['server memos', 'started; 2 tools'],
      ['tool memos/list_memos', 'read-only'],
      ['tool memos/add_memo', 'asks the user before each call'],
    ]);
  }, 120_000);
});
