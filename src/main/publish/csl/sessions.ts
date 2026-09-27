/**
 * One compiled CSL engine per export, a clean session per note (#2408).
 *
 * Every multi-note exporter wants a fresh citation *session* per note — each
 * page's footnotes start at 1, each page's References lists only what that
 * page cited — and used to get one by calling `citations.createRenderer()`
 * per note, plus once more for the bundle-level bibliography. Each call builds
 * a new `CSL.Engine`, and the engine's cost is compiling the style, not the
 * items: citeproc's `expandMacro` rescans the whole style tree once per macro
 * reference, so the cost scales with the style's size and is paid in full
 * every time. Measured on an M-series laptop, without coverage: ~300ms for
 * APA, ~700ms for Chicago notes & bibliography (242KB). So a 100-note project
 * exported as HTML compiled APA 100 times — ~30s spent reproducing the same
 * compiled style — and a Chicago tree export of N notes paid N+1 × 700ms.
 *
 * `CitationRenderer.reset()` already exists to make one engine serve many
 * sessions (#2210), and `tests/main/citations/engine-reuse.test.ts` pins that
 * a reset renderer is byte-identical to a fresh one for every bundled style.
 * This is the exporter-shaped handle on it: the first call compiles, every
 * later call resets and hands back the same renderer.
 *
 * ── The one rule ────────────────────────────────────────────────────────────
 * **Calling `next()` ends the previous session.** The renderer it returned is
 * the same object, now reset — so a caller must be finished reading
 * `cited()` / `renderFootnotes()` / `isNoteStyle` from one note before asking
 * for the next. Every exporter loop already has that shape (it reads the
 * renderer at the bottom of the iteration), and nothing renders two notes
 * concurrently within one export. The handle is local to one `run()`, so two
 * concurrent exports never share an engine.
 *
 * Built only on `createRenderer`, so the partial `CitationAssets` fakes some
 * tests hand to exporters keep working unchanged.
 */

import type { CitationRenderer } from './renderer';

type OutputFormat = { outputFormat?: 'html' | 'text' };

/** The one member of `CitationAssets` this needs (structural, to avoid an index↔sessions import cycle). */
interface RendererFactory {
  createRenderer(opts?: OutputFormat): CitationRenderer;
}

export interface RendererSessions {
  /**
   * Start a new citation session and return its renderer — `undefined` when
   * the plan has no citation assets. Ends whatever session the previous call
   * started (see the module comment).
   */
  next(): CitationRenderer | undefined;
}

export function createRendererSessions(
  citations: RendererFactory | undefined,
  opts?: OutputFormat,
): RendererSessions {
  let renderer: CitationRenderer | undefined;
  return {
    next() {
      if (!citations) return undefined;
      if (renderer) renderer.reset();
      else renderer = citations.createRenderer(opts);
      return renderer;
    },
  };
}
