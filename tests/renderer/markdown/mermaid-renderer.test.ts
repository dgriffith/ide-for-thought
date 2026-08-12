/**
 * @vitest-environment jsdom
 *
 * Mermaid label font resolution (#1802).
 *
 * Mermaid measures each label off-DOM in `document.body` (the UI font) but the
 * finished SVG is injected into `.preview` (the content font). Passing
 * `fontFamily: 'inherit'` let those disagree, so labels were sized for one font
 * and drawn in another — visibly clipped node text under any non-default
 * Appearance → Content font preset.
 *
 * jsdom can't measure glyphs, so these assert the contract that makes the two
 * agree: mermaid is initialized with the *preview's own resolved family*, and
 * re-initialized when that family changes (the cache is keyed on it, not just
 * on the theme).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const initialize = vi.fn();
const render = vi.fn(async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><g class="node"></g></svg>' }));

vi.mock('mermaid', () => ({ default: { initialize, render } }));
// The theme module reaches for app state we don't need here; pin it so the
// cache key varies only by font.
vi.mock('../../../src/renderer/lib/theme', () => ({
  getThemeMode: () => 'dark',
  getEffectiveTheme: () => 'dark',
}));

import { hydrateMermaidBlocks, invalidateMermaidTheme } from '../../../src/renderer/lib/markdown/mermaid-renderer';

/** A `.preview`-alike root holding one unrendered mermaid placeholder. */
function previewWith(fontFamily: string): HTMLElement {
  const root = document.createElement('div');
  root.style.fontFamily = fontFamily;
  const block = document.createElement('div');
  block.className = 'mermaid-block';
  block.textContent = 'flowchart LR\n  A[Write a note] --> B[Minerva indexes it]';
  root.appendChild(block);
  document.body.appendChild(root);
  return root;
}

function lastFontFamily(): unknown {
  const call = initialize.mock.calls.at(-1)?.[0] as { themeVariables?: Record<string, unknown> };
  return call?.themeVariables?.fontFamily;
}

describe('hydrateMermaidBlocks font resolution (#1802)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    initialize.mockClear();
    render.mockClear();
    invalidateMermaidTheme();
  });

  it('initializes mermaid with the preview\'s resolved font, not "inherit"', async () => {
    await hydrateMermaidBlocks(previewWith('"Berkeley Mono", monospace'));

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(lastFontFamily()).toBe('"Berkeley Mono", monospace');
    expect(lastFontFamily()).not.toBe('inherit');
  });

  it('re-initializes when the content font changes under an unchanged theme', async () => {
    await hydrateMermaidBlocks(previewWith('"IBM Plex Sans", sans-serif'));
    expect(lastFontFamily()).toBe('"IBM Plex Sans", sans-serif');

    // Same theme, different font — the old cache key ('dark') would have
    // short-circuited here and left every label measured for the previous font.
    await hydrateMermaidBlocks(previewWith('Georgia, serif'));

    expect(initialize).toHaveBeenCalledTimes(2);
    expect(lastFontFamily()).toBe('Georgia, serif');
  });

  it('does not re-initialize when neither theme nor font changed', async () => {
    await hydrateMermaidBlocks(previewWith('Georgia, serif'));
    await hydrateMermaidBlocks(previewWith('Georgia, serif'));

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('renders the diagram into the placeholder and marks it done', async () => {
    const root = previewWith('Georgia, serif');
    await hydrateMermaidBlocks(root);

    const block = root.querySelector('.mermaid-block');
    expect(block?.getAttribute('data-mermaid-rendered')).toBe('ok');
    expect(block?.querySelector('svg')).not.toBeNull();
    // Idempotent: an already-rendered block isn't re-rendered.
    await hydrateMermaidBlocks(root);
    expect(render).toHaveBeenCalledTimes(1);
  });
});
