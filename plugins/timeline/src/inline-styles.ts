/**
 * A drawn timeline as static HTML with its styles inline (#2829, as the
 * Kanban plugin's export, #2828): what `view.provideExport` hands Minerva,
 * whose sanitizer keeps inline styles only (no `<style>`, no URL). Each
 * element of a clone — the SVG's too — gets the computed values of the
 * properties the drawing's look depends on, colours resolved, so the export's
 * light theme needs no `var(--…)`. The drawing keeps its rule for scaling
 * down to a narrower page. A hatched bar's `fill: url(#…)` comes out of the
 * style (the sanitizer drops any `url(`) and stays on its `fill` attribute,
 * which points at the pattern in the same SVG. Classes stay: they name the
 * parts, and nothing in an export styles them.
 */

const PROPERTIES = [
  'display', 'box-sizing', 'flex-direction', 'flex-wrap', 'flex', 'align-items', 'justify-content', 'gap', 'row-gap', 'column-gap',
  'grid-template-columns', 'min-width', 'max-width',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
  'background-color', 'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant-numeric', 'line-height',
  'text-align', 'text-decoration-line', 'text-decoration-style', 'text-underline-offset',
  'white-space', 'overflow-wrap', 'word-break', 'list-style-type', 'break-inside', 'break-after',
  'fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'visibility',
];

/** The drawing scales down (its viewBox) on a page narrower than it. */
const RESPONSIVE: Record<string, Record<string, string>> = {
  'tl-axis': { 'max-width': '100%', height: 'auto' },
  'tl-plot': { 'max-width': '100%', height: 'auto' },
};

export function inlineStyles(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  const from = [root, ...root.querySelectorAll<Element>('*')];
  const to = [clone, ...clone.querySelectorAll<Element>('*')];
  from.forEach((el, i) => {
    const target = to[i]!;
    const style = getComputedStyle(el);
    const decls = PROPERTIES.map((p) => [p, style.getPropertyValue(p)] as const).filter(([, v]) => v !== '');
    const overrides = Object.entries(RESPONSIVE).find(([cls]) => el.classList.contains(cls))?.[1] ?? {};
    const all = new Map<string, string>([...decls, ...Object.entries(overrides)]);
    target.setAttribute('style', [...all].map(([p, v]) => `${p}: ${v}`).join('; '));
  });
  return clone.outerHTML;
}
