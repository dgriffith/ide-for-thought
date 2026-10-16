/**
 * @vitest-environment node
 *
 * Plugin settings (#2636): the schema in `plugin.json`, the per-machine
 * values (a secret write-only and never readable by a template), and a
 * plugin's skill reading `{{plugin.settings.*}}` end to end.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PluginManifest } from '../../../src/shared/plugins/format';
import { checkSettingValue, validatePluginSettings } from '../../../src/main/plugins/settings-schema';
import { validatePluginManifest } from '../../../src/main/plugins/manifest';
import {
  pluginSettingsFile,
  pluginSettingsForTemplates,
  readPluginSettings,
  removePluginSettings,
  savePluginSettings,
} from '../../../src/main/plugins/settings';
import { removePlugin } from '../../../src/main/plugins/lifecycle';
import { _disablePluginsForTests, enablePlugins, getPluginScan } from '../../../src/main/plugins/registry';
import { loadSkillCatalog } from '../../../src/main/skills/loader';
import { compileSkill } from '../../../src/main/skills/compile';
import { silenceLogTags } from '../../helpers/quiet-logs';

silenceLogTags('plugins', 'secrets', 'config');

const FIXTURES = path.resolve(__dirname, '..', '..', 'fixtures', 'plugins');
let tmp: string;
let dir: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugin-settings-')));
  dir = path.join(tmp, 'plugins');
  fs.mkdirSync(dir);
});
afterEach(() => {
  _disablePluginsForTests();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const SETTINGS = {
  length: { type: 'string', enum: ['short', 'long'], default: 'short' },
  maxItems: { type: 'number', title: 'Items', minimum: 1, maximum: 50, default: 10 },
  quotes: { type: 'boolean', default: true },
  note: { type: 'string', description: 'Added to each summary.' },
  apiToken: { type: 'secret', title: 'API token' },
};

const manifest = (settings: unknown = SETTINGS): PluginManifest => {
  const r = validatePluginManifest({
    id: 'lab', name: 'Lab', version: '1.0.0', minerva: '>=1.0.0', description: 'Lab tools',
    contributes: { skills: ['skills/a.md'] }, settings,
  }, { folder: 'lab', appVersion: '4.0.0' });
  if (!r.ok) throw new Error(r.problems.join('\n'));
  return r.manifest;
};

describe('the settings schema (#2636)', () => {
  it('reads each kind, in order, titling a field from its name when it has no title', () => {
    expect(manifest().settings).toEqual([
      { key: 'length', title: 'Length', kind: 'enum', options: ['short', 'long'], default: 'short' },
      { key: 'maxItems', title: 'Items', kind: 'number', minimum: 1, maximum: 50, default: 10 },
      { key: 'quotes', title: 'Quotes', kind: 'boolean', default: true },
      { key: 'note', title: 'Note', description: 'Added to each summary.', kind: 'string' },
      { key: 'apiToken', title: 'API token', kind: 'secret' },
    ]);
    expect(validatePluginSettings({ maxItemsPerRun: { type: 'number' } }, [])![0]!.title).toBe('Max items per run');
  });

  it.each([
    ['not an object', [], /"settings" must be an object/],
    ['a bad name', { 'two words': { type: 'string' } }, /a setting's name must be letters/],
    ['an unknown type', { a: { type: 'array' } }, /"type" must be one of string, number, boolean, secret/],
    ['an unknown keyword', { a: { type: 'string', pattern: '.*' } }, /"pattern" isn't allowed for a string setting/],
    ['a default on a secret', { a: { type: 'secret', default: 'hunter2' } }, /"default" isn't allowed for a secret setting/],
    ['a default that doesn\'t fit', { a: { type: 'number', maximum: 5, default: 9 } }, /"default" is outside/],
    ['a default outside its enum', { a: { type: 'string', enum: ['x'], default: 'y' } }, /must be one of its "enum"/],
    ['a repeated choice', { a: { type: 'string', enum: ['x', 'x'] } }, /"enum" must list/],
    ['a wrong-typed default', { a: { type: 'boolean', default: 'yes' } }, /must be true or false/],
    ['min over max', { a: { type: 'number', minimum: 5, maximum: 1 } }, /"minimum" is more than "maximum"/],
  ])('refuses %s, refusing the plugin', (_what, settings, msg) => {
    const r = validatePluginManifest({
      id: 'lab', name: 'Lab', version: '1.0.0', minerva: '>=1.0.0', description: 'd',
      contributes: { skills: ['skills/a.md'] }, settings,
    }, { folder: 'lab', appVersion: '4.0.0' });
    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.problems.join('\n')).toMatch(msg);
  });

  it('caps how many', () => {
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`s${i}`, { type: 'string' }]));
    const problems: string[] = [];
    validatePluginSettings(many, problems);
    expect(problems).toEqual(['"settings" has 40 settings; at most 32.']);
  });

  it('checks a value from the form', () => {
    const [length, maxItems, quotes, note] = manifest().settings!;
    expect(checkSettingValue(length!, 'long')).toEqual({ ok: true, value: 'long' });
    expect(checkSettingValue(length!, 'medium')).toEqual({ ok: false, problem: '"Length" must be one of short, long.' });
    expect(checkSettingValue(maxItems!, '12')).toEqual({ ok: true, value: 12 });
    expect(checkSettingValue(maxItems!, 51)).toEqual({ ok: false, problem: '"Items" must be at most 50.' });
    expect(checkSettingValue(maxItems!, 'many')).toEqual({ ok: false, problem: '"Items" must be a number.' });
    expect(checkSettingValue(quotes!, 'true')).toEqual({ ok: false, problem: '"Quotes" must be on or off.' });
    expect(checkSettingValue(note!, 'x'.repeat(2001))).toMatchObject({ ok: false });
  });
});

describe('the values (#2636)', () => {
  it('shows defaults until something is saved, and never a secret\'s value', async () => {
    const m = manifest();
    expect(await readPluginSettings(dir, m)).toEqual({
      fields: m.settings, values: { length: 'short', maxItems: 10, quotes: true }, secretsSet: { apiToken: false },
    });
    const view = await savePluginSettings(dir, m, { length: 'long', maxItems: 3, note: 'Be kind.', apiToken: 'tok-123' });
    expect(view.values).toEqual({ length: 'long', maxItems: 3, quotes: true, note: 'Be kind.' });
    expect(view.secretsSet).toEqual({ apiToken: true });
    expect(JSON.stringify(view)).not.toContain('tok-123');
    expect(await readPluginSettings(dir, m)).toEqual(view);
  });

  it('writes the file owner-only, beside plugins.json', async () => {
    await savePluginSettings(dir, manifest(), { apiToken: 'tok-123' });
    const file = pluginSettingsFile(dir);
    expect(file).toBe(path.join(tmp, 'plugin-settings.json'));
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  });

  it('null puts a value back to its default, and clears a secret; a secret left out is kept', async () => {
    const m = manifest();
    await savePluginSettings(dir, m, { length: 'long', apiToken: 'tok-123' });
    expect((await savePluginSettings(dir, m, { length: null })).values.length).toBe('short');
    expect((await readPluginSettings(dir, m)).secretsSet.apiToken).toBe(true);
    expect((await savePluginSettings(dir, m, { apiToken: null })).secretsSet.apiToken).toBe(false);
  });

  it('refuses a bad value, or a setting it doesn\'t declare, with every problem — and writes nothing', async () => {
    const m = manifest();
    await savePluginSettings(dir, m, { length: 'long' });
    const before = fs.readFileSync(pluginSettingsFile(dir), 'utf-8');
    await expect(savePluginSettings(dir, m, { maxItems: 99, quotes: 'yes', bogus: 1 }))
      .rejects.toThrow(/"Items" must be at most 50\.\n"Quotes" must be on or off\.\nLab has no setting "bogus"\./);
    expect(fs.readFileSync(pluginSettingsFile(dir), 'utf-8')).toBe(before);
  });

  it('a value the manifest no longer declares is ignored, and dropped on the next save', async () => {
    await savePluginSettings(dir, manifest(), { note: 'old', length: 'long' });
    const fewer = manifest({ length: SETTINGS.length });
    expect((await readPluginSettings(dir, fewer)).values).toEqual({ length: 'long' });
    await savePluginSettings(dir, fewer, { length: 'short' });
    expect(JSON.parse(fs.readFileSync(pluginSettingsFile(dir), 'utf-8'))).toEqual({ plugins: { lab: { length: 'short' } } });
  });

  it('a saved value that no longer fits reads as the default', async () => {
    fs.writeFileSync(pluginSettingsFile(dir), JSON.stringify({ plugins: { lab: { maxItems: 500, length: 'gone' } } }));
    expect((await readPluginSettings(dir, manifest())).values).toMatchObject({ maxItems: 10, length: 'short' });
  });

  it('a corrupt file is refused for a save and left as it is', async () => {
    fs.writeFileSync(pluginSettingsFile(dir), '{ not json');
    await expect(savePluginSettings(dir, manifest(), { length: 'long' })).rejects.toThrow();
    expect(fs.readFileSync(pluginSettingsFile(dir), 'utf-8')).toBe('{ not json');
  });

  it('templates see every non-secret value as text, and never a secret', async () => {
    const m = manifest();
    await savePluginSettings(dir, m, { maxItems: 3, apiToken: 'tok-123' });
    expect(pluginSettingsForTemplates(dir, m)).toEqual({ length: 'short', maxItems: '3', quotes: 'true' });
    expect(pluginSettingsForTemplates(dir, manifest({}))).toEqual({});
  });

  it('removing the plugin removes its values, secrets included', async () => {
    fs.cpSync(path.join(FIXTURES, 'reading-list'), path.join(dir, 'reading-list'), { recursive: true });
    await savePluginSettings(dir, manifest(), { apiToken: 'tok-123' });
    const rl = { ...manifest(), id: 'reading-list', name: 'Reading List', settings: [{ key: 'summaryLength', title: 'Summary length', kind: 'enum' as const, options: ['short', 'long'] }] };
    await savePluginSettings(dir, rl, { summaryLength: 'long' });
    await removePlugin(dir, 'reading-list');
    expect(JSON.parse(fs.readFileSync(pluginSettingsFile(dir), 'utf-8'))).toEqual({ plugins: { lab: { apiToken: 'tok-123' } } });
    await removePluginSettings(dir, 'lab');
    await removePluginSettings(dir, 'never-installed');
    expect(JSON.parse(fs.readFileSync(pluginSettingsFile(dir), 'utf-8'))).toEqual({ plugins: {} });
  });
});

describe('a plugin skill reads its settings (#2636)', () => {
  it('renders the saved value, or the default, at each run', async () => {
    fs.cpSync(path.join(FIXTURES, 'reading-list'), path.join(dir, 'reading-list'), { recursive: true });
    enablePlugins({ appVersion: '4.0.0', dir });
    const scan = await getPluginScan();
    const cat = await loadSkillCatalog(path.join(tmp, 'no-user-skills'), scan);
    const skill = cat.skills.find((s) => s.id === 'reading-list.reading-summary')!;
    expect(cat.errors).toEqual([]);
    const tool = compileSkill(skill);
    const ctx = { fullNoteContent: 'A book.', fullNoteTitle: 'Dune', fullNotePath: 'Dune.md' };

    expect(tool.buildSystemPrompt!(ctx)).toContain('Write a short summary');
    await savePluginSettings(dir, scan.plugins[0]!.manifest, { summaryLength: 'long' });
    expect(tool.buildSystemPrompt!(ctx)).toContain('Write a long summary');
  });

  it('a plugin skill naming a secret, or an undeclared setting, is refused — and a non-plugin skill can read none', async () => {
    const root = path.join(dir, 'lab');
    fs.mkdirSync(path.join(root, 'skills'), { recursive: true });
    fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({
      id: 'lab', name: 'Lab', version: '1.0.0', minerva: '>=1.0.0', description: 'd',
      contributes: { skills: ['skills/leak.md', 'skills/typo.md'] }, settings: SETTINGS,
    }));
    const skill = (id: string, body: string) => `---\nid: lab.${id}\nname: ${id}\ndescription: d\nmenu: Learning\n---\n${body}\n`;
    fs.writeFileSync(path.join(root, 'skills', 'leak.md'), skill('leak', 'Token: {{plugin.settings.apiToken}}'));
    fs.writeFileSync(path.join(root, 'skills', 'typo.md'), skill('typo', '{{#if plugin.settings.lenght}}x{{/if}}'));
    enablePlugins({ appVersion: '4.0.0', dir });
    const cat = await loadSkillCatalog(path.join(tmp, 'no-user-skills'), await getPluginScan());
    expect(cat.skills.filter((s) => s.plugin)).toEqual([]);
    const messages = cat.errors.map((e) => e.message).join('\n');
    expect(messages).toContain('"plugin.settings.apiToken" is a secret; a skill can\'t read a secret');
    expect(messages).toContain('"plugin.settings.lenght": the plugin declares no setting "lenght"');

    const userDir = path.join(tmp, 'user-skills');
    fs.mkdirSync(userDir);
    fs.writeFileSync(path.join(userDir, 'mine.md'), skill('mine', '{{plugin.settings.length}}').replace('lab.mine', 'mine'));
    const user = await loadSkillCatalog(userDir);
    expect(user.errors.map((e) => e.message).join('\n')).toContain('only a plugin\'s skills can read plugin settings');
  });
});
