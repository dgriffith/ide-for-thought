/**
 * @vitest-environment node
 *
 * Note templates from plugins (#2633): listed with their plugin, read by the
 * same unique filename as any other template. A thoughtbase template of the
 * same name wins, and a second plugin's template of a taken name is skipped.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listTemplates, readTemplate } from '../../../src/main/notebase/templates';
import { _disablePluginsForTests, enablePlugins } from '../../../src/main/plugins/registry';
import { writePlugin } from '../../helpers/plugins';
import { silenceLogTags } from '../../helpers/quiet-logs';

silenceLogTags('plugins');

let tmp: string;
let root: string;
let plugins: string;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugin-templates-')));
  root = path.join(tmp, 'tb');
  plugins = path.join(tmp, 'plugins');
  fs.mkdirSync(path.join(root, '.minerva', 'templates'), { recursive: true });
  fs.writeFileSync(path.join(root, '.minerva', 'templates', 'Meeting.md'), 'mine');
  writePlugin(plugins, 'a-lab', { 'note-templates': ['templates/Lab entry.md', 'templates/Meeting.md'] }, {
    'templates/Lab entry.md': 'from a-lab',
    'templates/Meeting.md': 'a-lab meeting',
  }, { name: 'Lab' });
  writePlugin(plugins, 'b-other', { 'note-templates': ['templates/Lab entry.md'] }, { 'templates/Lab entry.md': 'from b-other' });
  enablePlugins({ appVersion: '4.0.0', dir: plugins });
});
afterEach(() => {
  _disablePluginsForTests();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('plugin note templates (#2633)', () => {
  it('list with their plugin; a thoughtbase template of the same name wins; the second plugin\'s is skipped', async () => {
    expect(await listTemplates(root)).toEqual([
      { name: 'Lab entry', filename: 'Lab entry.md', plugin: { id: 'a-lab', name: 'Lab', version: '1.0.0' } },
      { name: 'Meeting', filename: 'Meeting.md' },
    ]);
  });

  it('read by filename: the thoughtbase\'s first, then the plugin\'s', async () => {
    expect(await readTemplate(root, 'Meeting.md')).toBe('mine');
    expect(await readTemplate(root, 'Lab entry.md')).toBe('from a-lab');
    await expect(readTemplate(root, 'Nope.md')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('a plugin\'s templates list even when the thoughtbase has no templates folder', async () => {
    fs.rmSync(path.join(root, '.minerva', 'templates'), { recursive: true });
    expect((await listTemplates(root)).map((t) => t.name)).toEqual(['Lab entry', 'Meeting']);
    expect(await readTemplate(root, 'Meeting.md')).toBe('a-lab meeting');
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('an unreadable templates folder throws, rather than reading as "no templates"', async () => {
    const dir = path.join(root, '.minerva', 'templates');
    fs.chmodSync(dir, 0o000);
    try {
      await expect(listTemplates(root)).rejects.toMatchObject({ code: 'EACCES' });
    } finally {
      fs.chmodSync(dir, 0o755);
    }
  });
});
