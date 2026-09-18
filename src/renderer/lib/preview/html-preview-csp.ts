/**
 * The CSP `HtmlPreview.svelte` imposes on a rendered `.html`/`.htm` file
 * (#1535). Lives outside the component so the policy string and the srcdoc
 * it builds are unit-testable without mounting anything — same rationale as
 * `compute-output-sanitize.ts` for `Preview.svelte`'s DOMPurify config.
 *
 * Scripts are OFF (`script-src 'none'`) — not merely unused. The original
 * design ran scripts inside a `sandbox="allow-scripts"` frame with no
 * `allow-same-origin`, on the theory that opaque-origin isolation plus a
 * tight CSP would make that safe. Verified empirically that it doesn't work
 * *at all*: a `srcdoc` (also `blob:`/`data:`) document's effective CSP is the
 * INTERSECTION of its own policy and its parent document's — Minerva's own
 * top-level page deliberately ships no `'unsafe-inline'` in `script-src` (a
 * real, load-bearing protection against XSS-style injection in the app's own
 * context), and that restriction propagates into any `srcdoc` iframe
 * regardless of what CSP is set on the iframe itself. There's no fixing this
 * from inside the iframe — escaping it needs a genuinely separate origin
 * (a custom protocol handler serving its own response headers), which is a
 * distinct piece of main-process work, not a tweak to this policy string.
 * Until/unless that ships, `sandbox=""` (no `allow-scripts` token at all, see
 * HtmlPreview.svelte) is the actual enforcement — `script-src 'none'` here is
 * belt-and-suspenders on top of it, not the thing doing the work.
 *
 * What's still real, inheritance and all: `default-src 'none'` plus
 * `img-src`/`font-src` limited to `data:`/`blob:` and `connect-src`/
 * `frame-src 'none'` block every form of network egress from plain markup —
 * no tracking-pixel `<img>`, no remote `<link rel=stylesheet>`, no nested
 * frames — none of which need a script to fire. `style-src 'unsafe-inline'`
 * is the one real opening: inline `<style>` still renders, which is how a
 * single-file HTML artifact is styled.
 */
export const HTML_PREVIEW_CSP =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; " +
  "img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; " +
  "form-action 'none';";

/**
 * The document handed to the iframe's `srcdoc`: the raw file content with a
 * `<meta http-equiv="Content-Security-Policy">` carrying the same policy
 * prepended. This is a SECOND, independent enforcement of `HTML_PREVIEW_CSP`
 * — belt and suspenders alongside the `csp` attribute the caller sets on the
 * iframe element itself (Content Security Policy Embedded Enforcement),
 * which is imposed from outside the document and doesn't depend on how
 * `content` happens to be structured (a `<!DOCTYPE>`, an existing `<head>`,
 * or no document scaffolding at all).
 */
export function buildHtmlPreviewSrcdoc(content: string): string {
  return `<meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}">${content}`;
}
