/**
 * A drawn calendar as static HTML with its styles inline (#2829, as the
 * Kanban plugin's export, #2828): what `view.provideExport` hands Minerva,
 * whose sanitizer keeps inline styles only (no `<style>`, no URL). Each
 * element of a clone gets the computed values of the properties the export
 * grid's look depends on, colours resolved, so the export's light theme needs
 * no `var(--…)`. Classes stay: they name the parts, and nothing in an export
 * styles them.
 *
 * Computed values are pixels at the frame's width, and the grid is laid out
 * in fractions of whatever width the page gives it. So what scales is put
 * back as the rule it was (`RESPONSIVE`): a row's seven equal columns (eight
 * with week numbers), a bar's width as its span of columns, and where a
 * hatched bar's uncertain days begin, and the `›` mark pushed to a bar's
 * end (an `auto` margin computes to the pixels it took). Heights aren't copied — a computed
 * height is the frame's, and would clip every row to it — except the few
 * parts that are a fixed size (`FIXED_HEIGHT`). The hatch itself is a
 * `repeating-linear-gradient`, which loads nothing and survives the
 * sanitizer.
 */

const PROPERTIES = [
  'display', 'box-sizing', 'flex-direction', 'flex-wrap', 'flex', 'align-items', 'justify-content', 'gap', 'row-gap', 'column-gap',
  'grid-template-columns', 'min-width', 'max-width', 'min-height',
  'position', 'top', 'right', 'bottom', 'left', 'z-index', 'overflow', 'text-overflow',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
  'background-color', 'background-image', 'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant-numeric', 'line-height',
  'text-align', 'text-decoration-line', 'text-decoration-style', 'text-underline-offset',
  'white-space', 'overflow-wrap', 'word-break', 'list-style-type', 'break-inside', 'break-after', 'page-break-inside',
];

/** The parts whose height is fixed by design, not by the frame: a bar's line, a day number, the legend swatch. */
const FIXED_HEIGHT: Record<string, string> = { 'calx-bar': '18px', 'calx-num': '18px', 'calx-swatch': '10px' };

/** The rules that scale with the page (see the header), for one element of the grid. */
function responsive(el: Element): Record<string, string> {
  const c = el.classList;
  const fixed = Object.entries(FIXED_HEIGHT).find(([cls]) => c.contains(cls));
  if (fixed && !c.contains('calx-bar')) return { height: fixed[1] };
  const own = (name: string, of: Element = el) => (of as HTMLElement).style?.getPropertyValue(name).trim() ?? '';
  if (c.contains('calx-row')) {
    return { 'grid-template-columns': el.closest('.calx-wk-on') ? '2.6em repeat(7, minmax(0, 1fr))' : 'repeat(7, minmax(0, 1fr))' };
  }
  if (c.contains('calx-bar')) {
    const span = own('--span') || '1';
    const before = c.contains('calx-cont-before');
    const after = c.contains('calx-cont-after');
    const less = before && after ? '0px' : before ? '2px' : '4px';
    return { width: `calc(${span} * 100% + (${span} - 1) * 1px - ${less})`, height: FIXED_HEIGHT['calx-bar']! };
  }
  if (c.contains('calx-mark-after')) return { 'margin-left': 'auto' };
  if (c.contains('calx-hatch')) {
    const bar = el.closest('.calx-bar');
    return { left: (bar ? own('--solid', bar) : '') || '0%' };
  }
  return {};
}

export function inlineStyles(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;
  const from = [root, ...root.querySelectorAll<Element>('*')];
  const to = [clone, ...clone.querySelectorAll<Element>('*')];
  from.forEach((el, i) => {
    const target = to[i]!;
    const style = getComputedStyle(el);
    const decls = PROPERTIES.map((p) => [p, style.getPropertyValue(p)] as const).filter(([, v]) => v !== '');
    const all = new Map<string, string>([...decls, ...Object.entries(responsive(el))]);
    target.setAttribute('style', [...all].map(([p, v]) => `${p}: ${v}`).join('; '));
  });
  return clone.outerHTML;
}
