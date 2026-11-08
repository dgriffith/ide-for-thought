/**
 * @vitest-environment happy-dom
 *
 * The in-app title bar per platform (#2191): on macOS it clears the traffic
 * lights and is the window's drag handle; on Windows and Linux the native
 * frame sits above it, so it has no gutter and drags nothing.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';

const platform = vi.hoisted(() => ({ IS_MAC: true }));
vi.mock('../../../src/renderer/lib/utils/platform', () => ({ get IS_MAC() { return platform.IS_MAC; } }));
vi.mock('../../../src/renderer/lib/command-palette/format-accelerator', () => ({
  formatAccelerator: (a: string) => (platform.IS_MAC ? a.replace('CmdOrCtrl+', '⌘') : a.replace('CmdOrCtrl', 'Ctrl')),
}));

import TitleBar from '../../../src/renderer/lib/components/TitleBar.svelte';

const props = {
  notebaseName: 'tb', filePath: null, isDirty: false, canGoBack: true, canGoForward: true,
  onNavBack: vi.fn(), onNavForward: vi.fn(), onOpenGotoNote: vi.fn(), onOpenSettings: vi.fn(),
};

afterEach(() => { cleanup(); platform.IS_MAC = true; });

describe('TitleBar (#2191)', () => {
  it('on macOS: the traffic-light gutter, ⌘ in its tooltips', () => {
    const { container } = render(TitleBar, props);
    expect(container.querySelector('.titlebar')!.classList.contains('native-frame')).toBe(false);
    expect(container.querySelector('[title^="Back"]')!.getAttribute('title')).toBe('Back (⌘[)');
  });

  it('off macOS: under the native frame, Ctrl in its tooltips', () => {
    platform.IS_MAC = false;
    const { container } = render(TitleBar, props);
    expect(container.querySelector('.titlebar')!.classList.contains('native-frame')).toBe(true);
    expect(container.querySelector('[title^="Back"]')!.getAttribute('title')).toBe('Back (Ctrl+[)');
    expect(container.querySelector('[title^="Quick Open"]')!.getAttribute('title')).toMatch(/^Quick Open \(Ctrl\+P\)/);
  });
});
