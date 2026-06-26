/**
 * Graph stylesheet building (#844) — pure mapping of Catppuccin tokens to a
 * Cytoscape stylesheet. (DOM token reading is exercised in the live verify.)
 */

import { describe, it, expect } from 'vitest';
import { buildGraphStyle, type GraphTokens } from '../../../src/renderer/lib/graph/cytoscape-theme';

const TOKENS: GraphTokens = {
  bg: '#1e1e2e', bgInset: '#181825', bgButton: '#313244',
  text: '#cdd6f4', textMuted: '#6c7086', border: '#45475a', accent: '#89b4fa',
};

function rule(style: ReturnType<typeof buildGraphStyle>, selector: string) {
  return style.find((s) => s.selector === selector)?.style;
}

describe('buildGraphStyle', () => {
  it('colors nodes + labels from the tokens', () => {
    const node = rule(buildGraphStyle(TOKENS), 'node')!;
    expect(node['background-color']).toBe('#313244');
    expect(node.color).toBe('#cdd6f4');
    expect(node.label).toBe('data(label)');
  });

  it('accents the root node', () => {
    expect(rule(buildGraphStyle(TOKENS), 'node[?root]')!['background-color']).toBe('#89b4fa');
  });

  it('styles source nodes distinctly (diamond) and missing targets muted', () => {
    expect(rule(buildGraphStyle(TOKENS), 'node[kind = "source"]')!.shape).toBe('diamond');
    expect(rule(buildGraphStyle(TOKENS), 'node[?missing]')!.color).toBe('#6c7086');
  });

  it('defaults edges to the muted color but lets per-edge linkColor win (View B)', () => {
    const style = buildGraphStyle(TOKENS);
    expect(rule(style, 'edge')!['line-color']).toBe('#6c7086');
    expect(rule(style, 'edge[linkColor]')!['line-color']).toBe('data(linkColor)');
  });

  it('re-skins: different tokens produce different colors', () => {
    const light = buildGraphStyle({ ...TOKENS, text: '#11111b', bgButton: '#e6e9ef' });
    expect(rule(light, 'node')!.color).toBe('#11111b');
    expect(rule(light, 'node')!['background-color']).toBe('#e6e9ef');
  });
});
