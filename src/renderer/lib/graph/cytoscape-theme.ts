/**
 * Catppuccin theming for the graph views (#843 / #844).
 *
 * Reads the app's CSS custom properties (the same tokens mermaid / vega skin
 * from) into a Cytoscape stylesheet, so graphs blend with the surrounding UI and
 * re-skin on theme switch. `readGraphTokens` touches the DOM; `buildGraphStyle`
 * is pure (takes resolved tokens) so the style rules are unit-testable.
 */

export interface GraphTokens {
  bg: string;
  bgInset: string;
  bgButton: string;
  text: string;
  textMuted: string;
  border: string;
  accent: string;
}

/** Read the live Catppuccin tokens off the document root. */
export function readGraphTokens(): GraphTokens {
  const cs = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    bg: get('--bg', '#1e1e2e'),
    bgInset: get('--bg-inset', '#181825'),
    bgButton: get('--bg-button', '#313244'),
    text: get('--text', '#cdd6f4'),
    textMuted: get('--text-muted', '#6c7086'),
    border: get('--border', '#313244'),
    accent: get('--accent', '#89b4fa'),
  };
}

/** Minimal shape we use from Cytoscape's stylesheet — avoids importing types. */
export type GraphStylesheet = Array<{ selector: string; style: Record<string, unknown> }>;

/**
 * Build the Cytoscape stylesheet from resolved tokens. Notes are rounded chips;
 * the synthetic root (View A) and graph root (View B) get the accent; source
 * nodes (View B) are a distinct diamond; non-existent targets render muted.
 * Edges use their own `linkColor` when present, falling back to the border.
 */
export function buildGraphStyle(tokens: GraphTokens): GraphStylesheet {
  return [
    {
      selector: 'node',
      style: {
        'background-color': tokens.bgButton,
        'border-width': 1,
        'border-color': tokens.border,
        shape: 'round-rectangle',
        label: 'data(label)',
        color: tokens.text,
        'font-size': 11,
        'font-family': 'inherit',
        'text-valign': 'center',
        'text-halign': 'center',
        'text-wrap': 'ellipsis',
        'text-max-width': 140,
        width: 'label',
        height: 'label',
        padding: 8,
      },
    },
    {
      // The note-title root (View A) / focused root (View B).
      selector: 'node[?root]',
      style: { 'background-color': tokens.accent, color: tokens.bg, 'border-color': tokens.accent, 'font-weight': 'bold' },
    },
    {
      // Source nodes (View B) — leaves, visually distinct.
      selector: 'node[kind = "source"]',
      style: { shape: 'diamond', 'background-color': tokens.bgInset, 'border-color': tokens.accent },
    },
    {
      // Link targets that don't exist on disk yet (View B).
      selector: 'node[?missing]',
      style: { 'background-color': tokens.bgInset, color: tokens.textMuted, 'border-style': 'dashed' },
    },
    {
      selector: 'node:selected',
      style: { 'border-width': 2, 'border-color': tokens.accent },
    },
    {
      selector: 'edge',
      style: {
        width: 1.5,
        'line-color': tokens.textMuted,
        'target-arrow-color': tokens.textMuted,
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.8,
        'curve-style': 'bezier',
      },
    },
    {
      // View B carries a per-edge color by link type (#844 sets it from linkColor).
      selector: 'edge[linkColor]',
      style: { 'line-color': 'data(linkColor)', 'target-arrow-color': 'data(linkColor)' },
    },
  ];
}
