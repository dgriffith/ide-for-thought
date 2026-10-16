/**
 * @vitest-environment node
 *
 * Colour themes from plugins (#2787): tokens only, from the built-in themes'
 * list; values only colours; a bad file refused on its own, naming why;
 * contrast checked and reported, never enforced; and the list follows the
 * plugin scan, so turning a plugin off takes its themes away.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { contrastRatio, contrastWarnings, parseThemeFile, pluginThemes, themeValueProblem } from '../../../src/main/plugins/themes';
import { _disablePluginsForTests, enablePlugins, reloadPluginScan } from '../../../src/main/plugins/registry';
import { setPluginEnabled } from '../../../src/main/plugins/lifecycle';
import { writePlugin } from '../../helpers/plugins';
import { silenceLogTags } from '../../helpers/quiet-logs';

silenceLogTags('plugins');

const SOLARIZED = path.resolve(__dirname, '..', '..', 'fixtures', 'plugins', 'solarized');
const ids = { plugin: 'lab', theme: 'night' };

describe('parseThemeFile (#2787)', () => {
  it('reads a theme, with its mode namespaced by plugin', () => {
    const r = parseThemeFile({ label: 'Night', base: 'dark', tokens: { '--bg': '#101010', '--accent': 'oklch(0.79 0.115 78)', '--bg-button': 'var(--bg-elev)' } }, ids);
    expect(r).toEqual({ ok: true, theme: { mode: 'plugin:lab/night', label: 'Night', base: 'dark', tokens: { '--bg': '#101010', '--accent': 'oklch(0.79 0.115 78)', '--bg-button': 'var(--bg-elev)' }, warnings: [] } });
  });

  it.each([
    ['a missing base', { label: 'x', tokens: { '--bg': '#000' } }, /"base" is required: "dark" or "light"/],
    ['a contrast base', { label: 'x', base: 'contrast', tokens: { '--bg': '#000' } }, /"base" is required/],
    ['an unknown token', { label: 'x', base: 'dark', tokens: { '--sidebar-width': '#000' } }, /unknown token "--sidebar-width"/],
    ['a font token', { label: 'x', base: 'dark', tokens: { '--font-sans': 'Comic Sans' } }, /unknown token "--font-sans"/],
    ['url()', { label: 'x', base: 'dark', tokens: { '--bg': 'url(https://x.example/a.png)' } }, /"--bg" must be a colour/],
    ['@import', { label: 'x', base: 'dark', tokens: { '--bg': '@import "x.css"' } }, /"--bg" must be a colour/],
    ['a selector break-out', { label: 'x', base: 'dark', tokens: { '--bg': '#000; } body { display: none' } }, /"--bg" must be a colour/],
    ['a var() of a non-token', { label: 'x', base: 'dark', tokens: { '--bg': 'var(--z-modal)' } }, /refers to "--z-modal"/],
    ['an unknown field', { label: 'x', base: 'dark', tokens: { '--bg': '#000' }, css: 'body{}' }, /unknown field "css"/],
    ['no tokens', { label: 'x', base: 'dark', tokens: {} }, /"tokens" is empty/],
    ['not an object', [], /must be a JSON object/],
  ])('refuses %s, naming it', (_what, raw, msg) => {
    const r = parseThemeFile(raw, ids);
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.problems.join('; ')).toMatch(msg);
  });

  it('values: colours of every common form, and nothing else', () => {
    for (const ok of ['#fff', '#ffffffcc', 'rgb(1, 2, 3)', 'rgba(1 2 3 / 50%)', 'hsl(120deg 50% 50%)', 'oklch(0.5 0.1 65)', 'transparent', 'var(--text)']) {
      expect(themeValueProblem(ok), ok).toBeNull();
    }
    for (const bad of ['expression(alert(1))', 'rgb(1,2,3) url(x)', '#ggg', 'var(--text) !important', '', 42]) {
      expect(themeValueProblem(bad), String(bad)).not.toBeNull();
    }
  });
});

describe('contrast (#2787)', () => {
  it('measures WCAG ratios for colours it can read', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 0);
    expect(contrastRatio('oklch(0.5 0.1 65)', '#fff')).toBeNull();
  });

  it('warns on a pair below AA, following aliases — and never refuses', () => {
    // --titlebar-text follows --text and --bg-titlebar follows --bg-elev: the known gotcha.
    const warnings = contrastWarnings({ '--text': '#777777', '--bg': '#ffffff', '--bg-elev': '#888888' });
    expect(warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/^--text on --bg is 4\.48:1/),
      expect.stringMatching(/^--titlebar-text on --bg-titlebar is 1\.\d\d:1/),
    ]));
    const r = parseThemeFile({ label: 'Low', base: 'light', tokens: { '--text': '#777777', '--bg': '#ffffff' } }, ids);
    // --text on --bg, and the app bar, whose colours alias to those two.
    expect(r.ok && r.theme.warnings.map((w) => w.split(' is ')[0])).toEqual(['--text on --bg', '--appbar-text on --bg-appbar']);
  });

  it('the Solarized example clears AA everywhere it\'s measured', () => {
    for (const f of ['solarized-dark', 'solarized-light']) {
      const raw: unknown = JSON.parse(fs.readFileSync(path.join(SOLARIZED, 'themes', `${f}.json`), 'utf-8'));
      const r = parseThemeFile(raw, { plugin: 'solarized', theme: f });
      expect(r.ok && r.theme.warnings, f).toEqual([]);
    }
  });
});

describe('pluginThemes (#2787)', () => {
  let tmp: string;
  let dir: string;
  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugin-themes-')));
    dir = path.join(tmp, 'plugins');
    fs.mkdirSync(dir);
  });
  afterEach(() => {
    _disablePluginsForTests();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('lists the enabled plugins\' themes; a bad file is refused on its own', async () => {
    fs.cpSync(SOLARIZED, path.join(dir, 'solarized'), { recursive: true });
    writePlugin(dir, 'broken', { themes: ['themes/a.json', 'themes/b.json', 'themes/c.json'] }, {
      'themes/a.json': '{ not json',
      'themes/b.json': JSON.stringify({ label: 'B', base: 'dark', tokens: { '--bg': 'url(x)' } }),
      'themes/c.json': JSON.stringify({ label: 'C', base: 'light', tokens: { '--accent': '#0055aa' } }),
    }, { name: 'Broken' });
    enablePlugins({ appVersion: '4.0.0', dir });
    await reloadPluginScan();
    const list = pluginThemes();
    expect(list.themes.map((t) => [t.mode, t.label, t.base, t.plugin.name])).toEqual([
      ['plugin:broken/c', 'C', 'light', 'Broken'],
      ['plugin:solarized/solarized-dark', 'Solarized Dark', 'dark', 'Solarized'],
      ['plugin:solarized/solarized-light', 'Solarized Light', 'light', 'Solarized'],
    ]);
    expect(list.problems).toEqual([
      { plugin: 'broken', file: 'themes/a.json', problem: expect.stringMatching(/isn't valid JSON/) },
      { plugin: 'broken', file: 'themes/b.json', problem: '"--bg" must be a colour: #hex, rgb(), hsl(), oklch() and the like, a colour name, or var(--token)' },
    ]);
    expect(pluginThemes()).toBe(list); // memoized until the scan changes
  });

  it('turning the plugin off takes its themes away', async () => {
    fs.cpSync(SOLARIZED, path.join(dir, 'solarized'), { recursive: true });
    enablePlugins({ appVersion: '4.0.0', dir });
    await reloadPluginScan();
    expect(pluginThemes().themes).toHaveLength(2);
    await setPluginEnabled(dir, 'solarized', false);
    await reloadPluginScan();
    expect(pluginThemes().themes).toEqual([]);
  });

  it('none when plugins aren\'t enabled', () => {
    expect(pluginThemes()).toEqual({ themes: [], problems: [] });
  });

  it('refuses an oversized file', async () => {
    writePlugin(dir, 'huge', { themes: ['themes/big.json'] }, { 'themes/big.json': JSON.stringify({ label: 'x', base: 'dark', tokens: { '--bg': '#000' }, pad: 'x'.repeat(70_000) }) });
    enablePlugins({ appVersion: '4.0.0', dir });
    await reloadPluginScan();
    expect(pluginThemes().problems[0]!.problem).toMatch(/a theme may be at most 65536/);
  });
});
