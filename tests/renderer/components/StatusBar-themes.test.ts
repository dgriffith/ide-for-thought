/**
 * @vitest-environment happy-dom
 *
 * The status bar's theme picker with plugin themes (#2787), through the real
 * plugin-themes store: the built-ins, then each plugin's themes after a
 * separator, picked like any other; a chosen theme whose plugin is gone reads
 * as the System it falls back to.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';

const h = vi.hoisted(() => ({ themes: vi.fn() }));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: { plugins: { themes: h.themes } } }));
vi.mock('../../../src/renderer/lib/voice/audio-recording.svelte', () => ({
  getAudioRecordingStore: () => ({ status: 'idle', recording: false, elapsedSec: 0 }),
}));

import StatusBar from '../../../src/renderer/lib/components/StatusBar.svelte';
import { pluginThemesStore } from '../../../src/renderer/lib/stores/plugin-themes.svelte';

beforeAll(async () => {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
  h.themes.mockResolvedValue({
    themes: [{
      mode: 'plugin:solarized/solarized-dark', label: 'Solarized Dark', base: 'dark', tokens: { '--bg': '#002b36' },
      plugin: { id: 'solarized', name: 'Solarized', version: '1.0.0' }, warnings: [],
    }],
    problems: [],
  });
  await pluginThemesStore.refresh();
});
afterEach(() => cleanup());

function renderBar(theme: string) {
  const onSelectTheme = vi.fn();
  const utils = render(StatusBar, {
    props: {
      cursor: { line: 1, column: 1, selectionLength: 0, wordCount: 0 },
      fontSize: 14,
      theme: theme as 'dark',
      onGotoLine: vi.fn(),
      onSelectTheme,
      onToggleDictation: vi.fn(),
      onToggleRecording: vi.fn(),
    },
  });
  return { ...utils, onSelectTheme };
}

describe('status bar theme picker (#2787)', () => {
  it('lists the built-ins, then the plugin\'s theme, and picks it', async () => {
    const { getByRole, getAllByRole, onSelectTheme } = renderBar('dark');
    await fireEvent.click(getByRole('button', { name: 'Dark' }));
    expect(getAllByRole('menuitemradio').map((b) => b.textContent?.trim())).toEqual(['Dark', 'Light', 'High Contrast', 'System', 'Solarized Dark']);
    expect(getAllByRole('separator')).toHaveLength(1);
    await fireEvent.click(getByRole('menuitemradio', { name: 'Solarized Dark' }));
    expect(onSelectTheme).toHaveBeenCalledWith('plugin:solarized/solarized-dark');
  });

  it('shows the chosen plugin theme by name, or System when it\'s gone', () => {
    expect(renderBar('plugin:solarized/solarized-dark').getByRole('button', { name: 'Solarized Dark' })).toBeTruthy();
    cleanup();
    expect(renderBar('plugin:gone/away').getByRole('button', { name: 'System' })).toBeTruthy();
  });
});
