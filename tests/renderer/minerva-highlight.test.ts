/**
 * Smoke coverage for the single token-driven highlight (#1117), which replaced
 * the oneDark theme across the note editor + query panel. These return opaque
 * CodeMirror extensions, so we pin that each builds without throwing and that
 * the shared HighlightStyle actually maps the palette tokens (a regression that
 * emptied the spec would still "build", so we assert the token colors too).
 */
import { describe, it, expect } from 'vitest';
import {
  minervaHighlightStyle,
  minervaSyntaxHighlighting,
  minervaSurfaceTheme,
} from '../../src/renderer/lib/editor/minerva-highlight';

describe('minerva-highlight (#1117)', () => {
  it('exposes a HighlightStyle and extension builders', () => {
    expect(minervaHighlightStyle).toBeTruthy();
    expect(minervaSyntaxHighlighting()).toBeTruthy();
    expect(minervaSurfaceTheme()).toBeTruthy();
  });

  it('drives syntax colors from design tokens, not hardcoded hex', () => {
    // HighlightStyle.define compiles the spec into a StyleModule; its rules
    // carry the color declarations. The palette must be var(--token) so it
    // re-skins per theme — and must never fall back to oneDark's hex slabs.
    const css = JSON.stringify(minervaHighlightStyle.module?.getRules() ?? '');
    expect(css).toContain('var(--iris)');
    expect(css).toContain('var(--accent)');
    expect(css).toContain('var(--sage)');
    expect(css).toContain('var(--rust)');
    expect(css).toContain('var(--text-faint)');
    expect(css).not.toContain('#282c34');
  });
});
