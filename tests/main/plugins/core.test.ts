/**
 * @vitest-environment node
 *
 * Core plugins (#2820): held to the same manifest format, on or off by a
 * record in plugins.json (or their default without one), and their ids
 * reserved, so nothing installed can stand in for one.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  _setCorePluginsForTests,
  corePlugins,
  isCorePluginId,
  readCorePluginStates,
  setCorePluginEnabled,
} from '../../../src/main/plugins/core';
import { pluginsStateFile } from '../../../src/main/plugins/state';
import { readPluginPackage } from '../../../src/main/plugins/package';

const manifest = (id: string, extra: Record<string, unknown> = {}) => ({
  id, name: `${id} name`, version: '1.0.0', minerva: '>=4.0.0', description: `The ${id} plugin.`, contributes: {}, ...extra,
});

let root: string;
let pluginsDir: string;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-core-plugins-')));
  pluginsDir = path.join(root, 'plugins');
  _setCorePluginsForTests([
    { manifest: manifest('python'), defaultEnabled: false },
    { manifest: manifest('kanban'), defaultEnabled: true },
  ]);
});
afterEach(() => {
  _setCorePluginsForTests(null);
  fs.rmSync(root, { recursive: true, force: true });
});

describe('core plugins (#2820)', () => {
  it('are checked by the plugin manifest validator, without a version check or a required contribution', () => {
    expect(corePlugins().map((p) => p.manifest.id)).toEqual(['python', 'kanban']);
    // `minerva` is a range this test's app version (0.0.0) doesn't satisfy:
    // a core plugin is this build, so it isn't checked.
    expect(corePlugins()[0]!.manifest.minerva).toBe('>=4.0.0');
  });

  it('a core manifest that doesn\'t validate is a bug in the build, so it throws', () => {
    _setCorePluginsForTests([{ manifest: { ...manifest('python'), surprise: true }, defaultEnabled: false }]);
    expect(() => corePlugins()).toThrow(/Core plugin "python" has an invalid manifest: Unknown field "surprise"/);
  });

  it('with no plugins.json, each is at its default', () => {
    expect(readCorePluginStates(pluginsDir)).toEqual(new Map([['python', false], ['kanban', true]]));
  });

  it('switching one writes a core record, and the state follows it', async () => {
    await setCorePluginEnabled(pluginsDir, 'python', true);
    await setCorePluginEnabled(pluginsDir, 'kanban', false);
    expect(readCorePluginStates(pluginsDir)).toEqual(new Map([['python', true], ['kanban', false]]));
    const written = JSON.parse(fs.readFileSync(pluginsStateFile(pluginsDir), 'utf-8'));
    expect(written.plugins.python).toEqual({ enabled: true, source: { kind: 'core' } });
  });

  it('a record left by an installed plugin of the same id doesn\'t decide a core plugin\'s state', () => {
    fs.writeFileSync(pluginsStateFile(pluginsDir), JSON.stringify({
      plugins: { python: { enabled: true, source: { kind: 'folder', path: '/old/python' } } },
    }));
    expect(readCorePluginStates(pluginsDir).get('python')).toBe(false);
  });

  it('switching an id that isn\'t a core plugin is refused', async () => {
    await expect(setCorePluginEnabled(pluginsDir, 'lab', true)).rejects.toThrow('No core plugin "lab".');
    expect(isCorePluginId('lab')).toBe(false);
    expect(isCorePluginId('python')).toBe(true);
  });

  it('a folder in the plugins folder claiming a core id is refused, saying where the real one is', async () => {
    const folder = path.join(pluginsDir, 'python');
    fs.mkdirSync(path.join(folder, 'skills'), { recursive: true });
    fs.writeFileSync(path.join(folder, 'skills', 'a.md'), '---\nid: x\nname: X\n---\nhi');
    fs.writeFileSync(path.join(folder, 'plugin.json'), JSON.stringify(manifest('python', { contributes: { skills: ['skills/a.md'] } })));
    const result = await readPluginPackage(folder, '4.0.0');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.problems).toEqual([
        '"python" is the id of a plugin built into Minerva; turn that one on or off in Settings → Plugins instead.',
      ]);
    }
  });
});
