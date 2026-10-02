/**
 * Turn a live component, mounted off-screen, into self-contained static HTML
 * for an export (#2510) — the "same as the preview" half of rendering live
 * blocks with the preview's own components.
 *
 * What a static copy needs that the live DOM doesn't carry:
 *
 * - **Its CSS.** Svelte's scoped styles live in the app bundle, not in the
 *   element. Every stylesheet rule whose selector matches something in the
 *   subtree is kept — tested with pseudo-classes stripped, so `:hover` rules
 *   survive — and re-scoped under the block wrapper, so a global rule that
 *   happened to match (`button { … }`) can't restyle the rest of an exported
 *   page.
 * - **Its theme tokens.** Rules read `var(--text)` etc.; the export has no
 *   app `:root`. Every custom property the kept rules reference is resolved
 *   on the themed element and written inline on the wrapper.
 * - **Real links.** Rows open a note through a click handler, which a static
 *   copy doesn't have. Each element carrying `data-note-path` becomes an
 *   `<a data-note-link>` (a table row gets one around its first cell); main
 *   resolves that to an href under the export's link policy, or to no link.
 *
 * Pure DOM work over a mounted subtree — the mounting is the caller's.
 */
import { LIVE_BLOCK_CLASS, NOTE_LINK_ATTR } from '../../../shared/live-blocks';

/** Snapshot `themed` (the element carrying `data-theme`, the mount's parent)
 *  as one self-contained block of HTML. */
export function snapshotLiveBlock(themed: HTMLElement): string {
  const css = collectCss(themed, `.${LIVE_BLOCK_CLASS}`);
  const vars = resolveVars(themed, css);
  const clone = themed.cloneNode(true) as HTMLElement;
  linkRows(clone);
  stripInteractivity(clone);
  clone.setAttribute('style', vars);
  // A row reads as it does in the preview — plain text, not a page link —
  // whatever the export page styles `a` as; a real link (follow-to-file)
  // shows itself on hover. Covers the bare `<a>` an unlinked row ends as.
  // Images keep the view's own spacing, not the export page's `img { margin:
  // 1em auto }` (#2511) — a gallery cover would shift inside its card.
  const base = `.${LIVE_BLOCK_CLASS}{margin:1em 0}.${LIVE_BLOCK_CLASS} a{color:inherit;text-decoration:none}.${LIVE_BLOCK_CLASS} a[href]:hover{text-decoration:underline}.${LIVE_BLOCK_CLASS} img{margin:0}`;
  return `<div class="${LIVE_BLOCK_CLASS}"><style>${base}${css}</style>${clone.outerHTML}</div>`;
}

/** Every rule (in any stylesheet, inside any @media/@supports) that applies
 *  to `root` or something in it, re-scoped under `scope`. */
export function collectCss(root: HTMLElement, scope: string): string {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch (err) {
      // A cross-origin sheet can't be read; it styles nothing of ours.
      if (err instanceof DOMException && err.name === 'SecurityError') continue;
      throw err;
    }
    collectRules(rules, root, scope, out);
  }
  return out.join('');
}

function collectRules(rules: CSSRuleList, root: HTMLElement, scope: string, out: string[]): void {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      const kept = rule.selectorText
        .split(/,(?![^(]*\))/)
        .map((s) => s.trim())
        .filter((s) => s && appliesWithin(root, s))
        .map((s) => `${scope} ${s}`);
      if (kept.length > 0) out.push(`${kept.join(',')}{${rule.style.cssText}}`);
    } else if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) {
      const inner: string[] = [];
      collectRules(rule.cssRules, root, scope, inner);
      if (inner.length > 0) out.push(`@${rule instanceof CSSMediaRule ? 'media' : 'supports'} ${rule.conditionText}{${inner.join('')}}`);
    } else if (rule instanceof CSSKeyframesRule) {
      out.push(rule.cssText); // animations a kept rule may name
    }
  }
}

/** Does `selector` match `root` or a descendant? Tested without pseudo-classes
 *  and pseudo-elements (a `:hover` rule applies to the element it names);
 *  document-level selectors never belong to a block. */
function appliesWithin(root: HTMLElement, selector: string): boolean {
  if (/(^|[\s>+~(,])(:root|html|body)\b/i.test(selector)) return false;
  const base = selector.replace(/::?[a-z-]+(\((?:[^()]|\([^()]*\))*\))?/gi, '').trim() || '*';
  try {
    return root.matches(base) || root.querySelector(base) !== null;
  } catch (err) {
    // A selector this engine can't parse (a newer syntax) matches nothing here.
    if (err instanceof DOMException && err.name === 'SyntaxError') return false;
    throw err;
  }
}

/** `--name: value;` for every custom property `css` references, resolved on `el`. */
function resolveVars(el: HTMLElement, css: string): string {
  const names = new Set<string>();
  for (const m of css.matchAll(/var\(\s*(--[\w-]+)/g)) names.add(m[1]!);
  const style = getComputedStyle(el);
  const decls: string[] = [];
  for (const name of names) {
    const value = style.getPropertyValue(name).trim();
    if (value) decls.push(`${name}:${value}`);
  }
  return decls.join(';');
}

/** Each `[data-note-path]` element becomes a link main can resolve. */
function linkRows(root: HTMLElement): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-note-path]'))) {
    const path = el.getAttribute('data-note-path') ?? '';
    el.removeAttribute('data-note-path');
    if (el.tagName === 'TR') {
      // A row can't sit inside a link; link its first cell's content instead.
      const cell = el.querySelector('td');
      if (!cell) continue;
      const a = document.createElement('a');
      a.setAttribute(NOTE_LINK_ATTR, path);
      while (cell.firstChild) a.appendChild(cell.firstChild);
      cell.appendChild(a);
      continue;
    }
    const a = document.createElement('a');
    for (const attr of Array.from(el.attributes)) {
      if (attr.name !== 'type') a.setAttribute(attr.name, attr.value);
    }
    a.setAttribute(NOTE_LINK_ATTR, path);
    while (el.firstChild) a.appendChild(el.firstChild);
    el.replaceWith(a);
  }
}

/** A static copy keeps no focus traps or handler-only controls. */
function stripInteractivity(root: HTMLElement): void {
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[tabindex], [aria-sort]'))) {
    el.removeAttribute('tabindex');
    el.removeAttribute('aria-sort');
  }
  for (const img of Array.from(root.querySelectorAll('img[loading]'))) img.removeAttribute('loading');
}
