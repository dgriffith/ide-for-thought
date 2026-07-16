/**
 * Defense-in-depth sanitisation for library-generated diagram SVG (#1331, L3).
 *
 * Mermaid renders a diagram to an SVG *string* that the renderer injects via
 * `innerHTML` (`mermaid-renderer.ts`). Today the only thing between a malicious
 * ```mermaid source and DOM injection is the app CSP (no `unsafe-inline` in
 * `script-src`) plus mermaid's own output. This adds an explicit, independent
 * scrub of the markup before it hits the DOM, so a mermaid sanitisation bypass
 * or a future CSP regression can't turn diagram source into an executing
 * `<script>` or inline event handler. CSP stays the primary control; this is the
 * second layer.
 *
 * Why not DOMPurify (as used for compute output): DOMPurify's allowlist strips
 * `<foreignObject>` HTML content, and mermaid v11 renders node labels as HTML
 * inside `<foreignObject>` — so a DOMPurify pass silently deletes every diagram
 * label. Instead this parses the SVG the same way the browser will when it's
 * assigned to `innerHTML` (the HTML parser, where `<foreignObject>` is an HTML
 * integration point so labels survive) and removes only the actual injection
 * surface: script/embed elements, SMIL animation elements (mermaid diagrams are
 * static; these are a known animate-to-script vector), `on*` handler attributes,
 * and `javascript:` / `vbscript:` / `data:text/html` URLs. Everything legitimate
 * — `<text>`/`<foreignObject>` labels, `<style>`, `<path>`, ids, classes, inline
 * styles, the ids/classes mermaid's post-render `bindFunctions` re-queries — is
 * preserved untouched.
 *
 * (Vega needs no equivalent: vega-embed builds the chart with safe DOM
 * construction — createElementNS/setAttribute via its SVG renderer — never
 * `innerHTML` of a generated string, and `ast: true` keeps expressions off
 * `new Function`.)
 */

/** Elements never legitimately present in a static rendered diagram. */
const FORBIDDEN_ELEMENTS = [
  'script', 'iframe', 'object', 'embed', 'form',
  // SMIL animation can retarget an href to a script URL; mermaid output is
  // static, so these are pure attack surface.
  'animate', 'animatetransform', 'animatemotion', 'set',
];

/** URL schemes that must never survive on href / xlink:href / src. */
const UNSAFE_URI_RE = /^\s*(?:javascript|vbscript|data:text\/html)/i;
const URI_ATTRS = new Set(['href', 'xlink:href', 'src']);

export function sanitizeDiagramSvg(svg: string): string {
  // Parse as HTML — the same parser the browser uses for `el.innerHTML = …`, so
  // `<foreignObject>` HTML labels are namespaced correctly and preserved.
  const doc = new DOMParser().parseFromString(svg, 'text/html');
  const container = doc.body;

  container.querySelectorAll(FORBIDDEN_ELEMENTS.join(',')).forEach((el) => el.remove());

  for (const el of container.querySelectorAll('*')) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
      } else if (URI_ATTRS.has(name) && UNSAFE_URI_RE.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  }

  return container.innerHTML;
}
