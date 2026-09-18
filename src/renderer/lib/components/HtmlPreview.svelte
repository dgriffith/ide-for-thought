<script lang="ts">
  /**
   * Rendered preview for a loose `.html`/`.htm` file in the tree (#1535).
   *
   * Distinct from `Preview.svelte` (markdown → sanitized-and-inlined DOM) and
   * from `sanitizeComputeOutputHtml` (DOMPurify, forbids script/iframe/object/
   * embed/form tags and injects the result directly into the app's own DOM).
   * Neither fits here: an LLM-authored HTML "artifact" is often a full
   * document (doctype, head, inline styling) — DOMPurify-into-DOM would strip
   * the document structure and let its styling leak into the app's own page.
   *
   * STATIC ONLY — scripts do not run. Matches #1130's original MVP
   * recommendation. This was NOT the original design: the first version ran
   * scripts inside `sandbox="allow-scripts"` (no `allow-same-origin`), on the
   * theory that opaque-origin isolation plus a tight CSP on the iframe would
   * make that safe. Verified empirically that it does not work: a `srcdoc`
   * document's effective CSP is the INTERSECTION of its own policy and its
   * parent's, and Minerva's own top-level page deliberately ships no
   * `'unsafe-inline'` in `script-src` — that restriction propagates into any
   * `srcdoc` iframe regardless of what CSP the iframe itself declares.
   * Escaping it needs a genuinely separate origin (a custom protocol handler
   * with its own response headers), which is real main-process work, not
   * something fixable from in here. See `html-preview-csp.ts` for the longer
   * writeup and `git log` on this file for the abandoned scripted version.
   *
   * Security model — two independent layers, deliberately redundant:
   *
   *  1. `sandbox=""` — no tokens at all. No scripting (the sandbox flag
   *     disables the scripting flag on the browsing context outright, ahead
   *     of and independent of any CSP), no same-origin (opaque origin — no
   *     access to the parent page, cookies, or storage), no forms, no
   *     popups, no top-level navigation.
   *  2. A restrictive CSP imposed on the embedded document from OUTSIDE it,
   *     via the `csp` attribute (Content Security Policy Embedded
   *     Enforcement). Even with scripting off, plain markup can still make
   *     network requests — a tracking-pixel `<img>`, a remote
   *     `<link rel=stylesheet>` — so `connect-src`/`frame-src 'none'` and
   *     `img-src`/`font-src` restricted to `data:`/`blob:` block those too.
   *     A meta-tag CSP carrying the same policy is ALSO prepended to the
   *     srcdoc as a second, independent enforcement path — belt and
   *     suspenders, in case a given Chromium build ever fails to honor the
   *     `csp` attribute for a srcdoc frame.
   */
  import { HTML_PREVIEW_CSP, buildHtmlPreviewSrcdoc } from '../preview/html-preview-csp';

  interface Props {
    content: string;
  }

  let { content }: Props = $props();

  /**
   * `csp` isn't a typed Svelte iframe attribute (Content Security Policy
   * Embedded Enforcement is recent enough that svelte/elements.d.ts doesn't
   * list it), which is a lucky forcing function: it pushes `csp` and
   * `srcdoc` into one imperative step instead of two independently-ordered
   * bound attributes. Order matters here — `csp` must land on the element
   * BEFORE `srcdoc` does, or the browser could start loading the document
   * before the embedder-imposed policy is in place to gate it.
   */
  function sandboxedDoc(node: HTMLIFrameElement, html: string) {
    function render(next: string) {
      node.setAttribute('csp', HTML_PREVIEW_CSP);
      node.srcdoc = buildHtmlPreviewSrcdoc(next);
    }
    render(html);
    return { update: render };
  }
</script>

<iframe
  class="html-preview-frame"
  title="HTML preview"
  sandbox=""
  referrerpolicy="no-referrer"
  use:sandboxedDoc={content}
></iframe>

<style>
  .html-preview-frame {
    width: 100%;
    height: 100%;
    border: none;
    background: var(--bg);
  }
</style>
