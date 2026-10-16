/**
 * @vitest-environment happy-dom
 *
 * Applying a plugin theme (#2787): its generated block cascades over its
 * base, a light-based one inherits the light tokens, a theme whose plugin is
 * gone falls back to System without the choice being forgotten, and coming
 * back restores it. The chosen theme paints from a cache at launch, before
 * main has listed the plugins' themes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { PluginTheme } from '../../src/shared/theme';

const CSS = fs.readFileSync(path.resolve(__dirname, '..', '..', 'src', 'renderer', 'styles', 'global.css'), 'utf-8');

const theme = (over: Partial<PluginTheme> = {}): PluginTheme => ({
  mode: 'plugin:solarized/solarized-dark', label: 'Solarized Dark', base: 'dark',
  tokens: { '--bg': '#002b36', '--accent': '#b58900' },
  plugin: { id: 'solarized', name: 'Solarized', version: '1.0.0' }, warnings: [],
  ...over,
});
const LIGHT = theme({ mode: 'plugin:solarized/solarized-light', label: 'Solarized Light', base: 'light', tokens: { '--bg': '#fdf6e3' } });

/** A fresh copy of theme.ts: its "not loaded yet" state is per module. */
async function load() {
  return import('../../src/renderer/lib/theme');
}

const root = () => document.documentElement;
const token = (name: string) => getComputedStyle(root()).getPropertyValue(name).trim();

beforeEach(async () => {
  const { vi } = await import('vitest');
  vi.resetModules();
  localStorage.clear();
  root().removeAttribute('data-theme');
  root().removeAttribute('data-theme-base');
  document.head.innerHTML = `<style id="global">${CSS}</style>`;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
});

describe('plugin themes in the renderer (#2787)', () => {
  it('applies a dark-based theme: its block over the dark defaults', async () => {
    const t = await load();
    t.setPluginThemes([theme(), LIGHT]);
    t.setThemeMode('plugin:solarized/solarized-dark');
    expect(root().getAttribute('data-theme')).toBe('plugin:solarized/solarized-dark');
    expect(root().hasAttribute('data-theme-base')).toBe(false);
    expect(token('--bg')).toBe('#002b36');
    // A token it leaves out comes from the base.
    expect(token('--text')).toBe('oklch(0.925 0.018 85)');
    expect(t.getEffectiveTheme(t.getThemeMode())).toBe('dark');
  });

  it('a light-based theme inherits the light tokens it leaves out', async () => {
    const t = await load();
    t.setPluginThemes([theme(), LIGHT]);
    t.setThemeMode(LIGHT.mode);
    expect(root().getAttribute('data-theme-base')).toBe('light');
    expect(token('--bg')).toBe('#fdf6e3');
    expect(token('--text')).toBe('oklch(0.235 0.018 70)');
    expect(t.getEffectiveTheme(LIGHT.mode)).toBe('light');
  });

  it('two themes on one base have different cache keys; a built-in keys as itself', async () => {
    const t = await load();
    t.setPluginThemes([theme(), theme({ mode: 'plugin:other/night', label: 'Night' })]);
    expect(t.getAppliedThemeKey('plugin:solarized/solarized-dark')).not.toBe(t.getAppliedThemeKey('plugin:other/night'));
    expect(t.getAppliedThemeKey('light')).toBe('light');
  });

  it('its plugin gone: System is shown and the choice kept; back again, it\'s restored', async () => {
    const t = await load();
    t.setPluginThemes([theme()]);
    t.setThemeMode('plugin:solarized/solarized-dark');
    t.setPluginThemes([]);
    t.applyTheme(t.getThemeMode());
    expect(t.getThemeMode()).toBe('plugin:solarized/solarized-dark');
    expect(root().hasAttribute('data-theme')).toBe(false); // System, on a dark OS
    expect(token('--bg')).toBe('oklch(0.205 0.012 70)');
    expect(t.getEffectiveTheme(t.getThemeMode())).toBe('dark');
    expect(document.getElementById('minerva-plugin-themes')).toBeNull();

    t.setPluginThemes([theme()]);
    t.applyTheme(t.getThemeMode());
    expect(root().getAttribute('data-theme')).toBe('plugin:solarized/solarized-dark');
  });

  it('paints the chosen theme from the cache before main has answered', async () => {
    const first = await load();
    first.setPluginThemes([theme()]);
    first.setThemeMode('plugin:solarized/solarized-dark');

    const { vi } = await import('vitest');
    vi.resetModules();
    document.getElementById('minerva-plugin-themes')?.remove();
    root().removeAttribute('data-theme');
    const relaunched = await load();
    relaunched.initTheme();
    expect(root().getAttribute('data-theme')).toBe('plugin:solarized/solarized-dark');
    expect(token('--bg')).toBe('#002b36');
  });

  it('a stored value that isn\'t a theme reads as System; ⌘⇧T from a plugin theme goes to Dark', async () => {
    localStorage.setItem('themeMode', 'plugin:"><script>');
    const t = await load();
    expect(t.getThemeMode()).toBe('system');
    t.setPluginThemes([theme()]);
    t.setThemeMode('plugin:solarized/solarized-dark');
    expect(t.cycleTheme()).toBe('dark');
  });

  it('the generated block keeps only known tokens and plain values', async () => {
    const t = await load();
    const css = t.pluginThemeCss(theme({ tokens: { '--bg': '#000', '--z-modal': '1', '--text': 'red; } body { display: none' } }));
    expect(css).toBe(':root[data-theme="plugin:solarized/solarized-dark"] {\n  --bg: #000;\n}');
  });
});
