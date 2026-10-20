/**
 * @vitest-environment node
 *
 * Wiring core plugins up and down (#2820): a plugin that's on is activated at
 * startup, one that's off is not, and turning one off takes down what it
 * wired up — its IPC handlers included, so off means the channel doesn't
 * exist, not that it's hidden.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ipc = vi.hoisted(() => ({ handlers: new Map<string, unknown>() }));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: unknown) => {
      if (ipc.handlers.has(channel)) throw new Error(`second handler for ${channel}`);
      ipc.handlers.set(channel, fn);
    },
    removeHandler: (channel: string) => { ipc.handlers.delete(channel); },
  },
}));

import { _setCoreActivationsForTests, activeCorePlugins, startCorePlugins, syncCorePlugins } from '../../src/main/core-plugins';
import { _setCorePluginsForTests, readCorePluginStates, setCorePluginEnabled } from '../../src/main/plugins/core';
import { _disablePluginsForTests, enablePlugins } from '../../src/main/plugins/registry';
import { handle } from '../../src/main/ipc/typed-ipc';
import { Channels } from '../../src/shared/channels';
import { silenceLogTags } from '../helpers/quiet-logs';

const manifest = (id: string) => ({ id, name: id, version: '1.0.0', minerva: '>=4.0.0', description: `The ${id} plugin.`, contributes: {} });

let root: string;
let pluginsDir: string;
const stops: string[] = [];

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-core-wiring-')));
  pluginsDir = path.join(root, 'plugins');
  enablePlugins({ appVersion: '4.0.0', dir: pluginsDir });
  _setCorePluginsForTests([
    { manifest: manifest('python'), defaultEnabled: false },
    { manifest: manifest('kanban'), defaultEnabled: true },
  ]);
  stops.length = 0;
  _setCoreActivationsForTests({
    // A real handler through the real `handle()`, as a core plugin's would be.
    python: () => {
      const remove = handle(Channels.COMPUTE_PROBE_PYTHON, () => ({ ok: true, version: '3.12' }) as never);
      return () => { remove(); stops.push('python'); };
    },
    kanban: () => () => { stops.push('kanban'); },
  });
});
afterEach(() => {
  _setCoreActivationsForTests(null);
  _setCorePluginsForTests(null);
  _disablePluginsForTests();
  ipc.handlers.clear();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('core plugin wiring (#2820)', () => {
  it('at startup, only the ones that are on are wired up', () => {
    startCorePlugins();
    expect(activeCorePlugins()).toEqual(['kanban']);
    expect(ipc.handlers.has(Channels.COMPUTE_PROBE_PYTHON)).toBe(false);
  });

  it('turning one on registers its handlers; turning it off removes them again', async () => {
    startCorePlugins();
    await setCorePluginEnabled(pluginsDir, 'python', true);
    syncCorePlugins();
    expect(activeCorePlugins().sort()).toEqual(['kanban', 'python']);
    expect(ipc.handlers.has(Channels.COMPUTE_PROBE_PYTHON)).toBe(true);

    await setCorePluginEnabled(pluginsDir, 'python', false);
    syncCorePlugins();
    expect(activeCorePlugins()).toEqual(['kanban']);
    expect(ipc.handlers.has(Channels.COMPUTE_PROBE_PYTHON)).toBe(false);
    expect(stops).toEqual(['python']);
  });

  it('a sync that changes nothing wires nothing twice', () => {
    startCorePlugins();
    syncCorePlugins();
    syncCorePlugins();
    expect(activeCorePlugins()).toEqual(['kanban']);
    expect(stops).toEqual([]);
  });

  describe('a core plugin that fails', () => {
    silenceLogTags('plugins');

    it('to start costs only itself', () => {
      _setCoreActivationsForTests({
        kanban: () => { throw new Error('no board'); },
      });
      _setCorePluginsForTests([
        { manifest: manifest('kanban'), defaultEnabled: true },
        { manifest: manifest('calendar'), defaultEnabled: true },
      ]);
      expect(() => startCorePlugins()).not.toThrow();
      expect(activeCorePlugins()).toEqual([]);
    });

    it('to stop is still taken down', async () => {
      _setCoreActivationsForTests({ kanban: () => () => { throw new Error('stuck'); } });
      startCorePlugins();
      await setCorePluginEnabled(pluginsDir, 'kanban', false);
      expect(() => syncCorePlugins()).not.toThrow();
      expect(activeCorePlugins()).toEqual([]);
    });
  });
});

describe('a plugin that used to be part of Minerva keeps going for people who used it (#2822)', () => {
  const withHistory = (used: boolean) => _setCoreActivationsForTests(
    { python: () => () => { stops.push('python'); }, kanban: () => () => undefined },
    { python: () => used },
  );

  it('on a machine that used it and never switched it, it\'s recorded on, once, and wired up', () => {
    withHistory(true);
    startCorePlugins();
    expect(activeCorePlugins().sort()).toEqual(['kanban', 'python']);
    expect(readCorePluginStates(pluginsDir).get('python')).toBe(true);
  });

  it('on a machine that never used it, it stays at its default: off', () => {
    withHistory(false);
    startCorePlugins();
    expect(activeCorePlugins()).toEqual(['kanban']);
  });

  it('a machine that switched it off keeps it off, used or not', async () => {
    await setCorePluginEnabled(pluginsDir, 'python', false);
    withHistory(true);
    startCorePlugins();
    expect(activeCorePlugins()).toEqual(['kanban']);
  });
});
