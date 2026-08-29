/**
 * Preview.svelte's click routing (#993, extracted #1904). `handleClick` walks
 * a `[selector, handler]` table and dispatches to the first branch whose
 * `.closest(selector)` matches the click target. Each handler receives the
 * matched element + the event and returns true once it has consumed the
 * click (false = "not mine, keep looking" — used by the branches that only
 * conditionally handle). Bundled with the fence-run pipeline
 * (`runFenceAt`/`runAllCells`) since the fence-action route is the one click
 * handler that can't finish synchronously.
 *
 * Same shape as `editor/context-menu.ts` / `editor/view-commands.ts`: an
 * `Ops` closure struct so these stay pure functions instead of touching
 * Svelte state directly. Preview.svelte keeps a one-line wrapper per
 * template-bound handler (`onclick={handleClick}`) and for the exported
 * `runAllCells` (`bind:this` access).
 */
import { api } from '../ipc/client';
import type { CellResult } from '../ipc/client';
import { findRunnableFences, codeOf, RUNNABLE_LANGUAGE_SET } from '../../../shared/compute/fences';
import { runAllCellsInContent } from '../compute/run-all-cells';
import { logger } from '../../../shared/logger';
import { planOutputEdit } from '../editor/output-block';
import { hydrateVegaBlocks } from '../markdown/vega-renderer';

export interface ClickRoutingOps {
  getPreviewEl: () => HTMLDivElement | undefined;
  getContent: () => string;
  getNotePath: () => string | null;
  getRunningFences: () => Set<number>;
  getCollapsedFences: () => Set<number>;
  onNavigate: (target: string) => void;
  onOpenSource: ((sourceId: string) => void) | undefined;
  onOpenExcerpt: ((excerptId: string) => void) | undefined;
  onTagSelect: ((tag: string) => void) | undefined;
  onDoiClick: ((doi: string) => void) | undefined;
  onTaskToggle: ((lineIndex: number) => void) | undefined;
  onRunCell: ((language: string, code: string, notePath: string) => Promise<CellResult>) | undefined;
  onApplyCellOutputEdit: ((newContent: string) => void) | undefined;
  /** Dismisses the hover tooltip — owned by Preview's tooltip concern; a click
   *  always dismisses first so a stale tooltip can't linger over new content. */
  dismissTooltip: () => void;
  /** Opens the compute-output overflow menu — owned by Preview's output-menu
   *  concern; the fence toolbar's "⋯" button routes here. */
  openOutputMenu: (btn: HTMLElement, wrap: HTMLElement) => void;
}

type ClickRouteHandler = (ops: ClickRoutingOps, matched: HTMLElement, e: MouseEvent) => boolean;

const CLICK_ROUTES: [selector: string, handler: ClickRouteHandler][] = [
  ['.cite-link', handleCiteLinkClick],
  ['.quote-link', handleQuoteLinkClick],
  ['.wiki-link', handleWikiLinkClick],
  ['.transclusion-open', handleTransclusionOpenClick],
  ['.note-tag', handleTagClick],
  ['.compute-output-menu-btn', handleComputeMenuBtnClick],
  ['.compute-output-image', handleOutputImageClick],
  ['[data-fence-action]', handleFenceActionClick],
  ['.youtube-embed', handleYouTubeEmbedClick],
  ['a[href^="https://doi.org/"]', handleDoiAnchorClick],
  ['a[href^="#"]', handleInternalAnchorClick],
];

export function handleClick(ops: ClickRoutingOps, e: MouseEvent): void {
  const el = e.target as HTMLElement;
  // Dismiss any open hover tooltip first. Clicking a wiki-link navigates
  // the preview and replaces the DOM before a `mouseout` can fire on the
  // now-destroyed link, which otherwise leaves the tooltip stuck onscreen
  // over the newly-loaded note. A click means "acting, not hovering".
  ops.dismissTooltip();
  if (handleTaskCheckboxClick(ops, el)) return;
  for (const [selector, handler] of CLICK_ROUTES) {
    const matched = el.closest<HTMLElement>(selector);
    if (matched && handler(ops, matched, e)) return;
  }
}

function handleTaskCheckboxClick(ops: ClickRoutingOps, el: HTMLElement): boolean {
  if (
    !(el instanceof HTMLInputElement) ||
    el.type !== 'checkbox' ||
    el.dataset.taskLine === undefined
  ) {
    return false;
  }
  const line = parseInt(el.dataset.taskLine, 10);
  if (!Number.isNaN(line)) ops.onTaskToggle?.(line);
  // Don't preventDefault — the native toggle gives an instant flicker-free
  // response. The content re-render will land the DOM in the same state.
  return true;
}

function handleCiteLinkClick(ops: ClickRoutingOps, citeLink: HTMLElement, e: MouseEvent): boolean {
  e.preventDefault();
  const sourceId = citeLink.dataset.sourceId;
  if (sourceId && ops.onOpenSource) ops.onOpenSource(sourceId);
  return true;
}

function handleQuoteLinkClick(ops: ClickRoutingOps, quoteLink: HTMLElement, e: MouseEvent): boolean {
  e.preventDefault();
  const excerptId = quoteLink.dataset.excerptId;
  if (excerptId && ops.onOpenExcerpt) ops.onOpenExcerpt(excerptId);
  return true;
}

function handleWikiLinkClick(ops: ClickRoutingOps, wikiLink: HTMLElement, e: MouseEvent): boolean {
  e.preventDefault();
  const linkTarget = wikiLink.dataset.target;
  if (linkTarget) ops.onNavigate(linkTarget);
  return true;
}

// Transclusion header → open the embedded note (#906).
function handleTransclusionOpenClick(ops: ClickRoutingOps, transclusionOpen: HTMLElement, e: MouseEvent): boolean {
  e.preventDefault();
  const t = transclusionOpen.dataset.target;
  if (t) ops.onNavigate(t);
  return true;
}

function handleTagClick(ops: ClickRoutingOps, tagEl: HTMLElement, e: MouseEvent): boolean {
  e.preventDefault();
  const tag = tagEl.dataset.tag;
  if (tag && ops.onTagSelect) ops.onTagSelect(tag);
  return true;
}

// Compute-output overflow menu (#244).
function handleComputeMenuBtnClick(ops: ClickRoutingOps, menuBtn: HTMLElement, e: MouseEvent): boolean {
  e.preventDefault();
  e.stopPropagation();
  const wrap = menuBtn.closest<HTMLElement>('.compute-output-wrap');
  if (!wrap) return true;
  ops.openOutputMenu(menuBtn, wrap);
  return true;
}

// Click-to-zoom on inline compute output images (#243). Toggles a `.zoomed`
// class so the stylesheet flips between thumbnail and full-size views
// without a modal dialog. Not an image element → fall through to the next
// route (matches the original guard).
function handleOutputImageClick(_ops: ClickRoutingOps, outputImg: HTMLElement, e: MouseEvent): boolean {
  if (!(outputImg instanceof HTMLImageElement)) return false;
  e.preventDefault();
  outputImg.classList.toggle('zoomed');
  return true;
}

// Fence toolbar — collapse toggle + run button.
function handleFenceActionClick(ops: ClickRoutingOps, fenceBtn: HTMLElement, e: MouseEvent): boolean {
  e.preventDefault();
  e.stopPropagation();
  const action = fenceBtn.getAttribute('data-fence-action');
  const block = fenceBtn.closest<HTMLElement>('.fence-block');
  const lineAttr = block?.getAttribute('data-fence-line');
  const openingLine = lineAttr ? parseInt(lineAttr, 10) : NaN;
  if (!block || Number.isNaN(openingLine)) return true;
  if (action === 'collapse') {
    // Pure UI toggle — flip the class on the live DOM instead of
    // forcing a markdown re-render. The collapsedFences set stays
    // in sync so the next real re-render (e.g. after an edit)
    // honors the current state.
    const collapsedFences = ops.getCollapsedFences();
    if (collapsedFences.has(openingLine)) {
      collapsedFences.delete(openingLine);
      block.classList.remove('fence-collapsed');
    } else {
      collapsedFences.add(openingLine);
      block.classList.add('fence-collapsed');
    }
    const tBtn = block.querySelector<HTMLElement>('.fence-collapse-btn');
    if (tBtn) tBtn.textContent = collapsedFences.has(openingLine) ? '▸' : '▾';
    return true;
  }
  if (action === 'run') {
    void runFenceAt(ops, openingLine);
    return true;
  }
  if (action === 'refresh-vega') {
    // Re-resolve a data-bound chart (#832): drop its rendered state and
    // re-hydrate, which re-runs the query against the current graph.
    const vegaBlock = block.querySelector<HTMLElement>('.vega-block');
    if (vegaBlock) {
      vegaBlock.removeAttribute('data-vega-rendered');
      vegaBlock.innerHTML = '';
      const previewEl = ops.getPreviewEl();
      if (previewEl) void hydrateVegaBlocks(previewEl, ops.getContent());
    }
    return true;
  }
  return true;
}

// YouTube poster card (#904) — open the video in the real browser rather
// than navigating the renderer. `data-youtube-url` is a normalized
// youtube.com watch URL; openExternal's main-process handler re-validates
// it's http(s) before handing off to the OS.
function handleYouTubeEmbedClick(_ops: ClickRoutingOps, ytEmbed: HTMLElement, e: MouseEvent): boolean {
  e.preventDefault();
  const url = ytEmbed.getAttribute('data-youtube-url');
  if (url) void api.shell.openExternal(url);
  return true;
}

// DOI link click — the doi-plugin auto-linker rendered this. The host
// decides between "open existing source" and "offer to ingest" based on
// whether the DOI matches a known source. (#473) Without an onDoiClick
// handler, leave the click alone (fall through to the next route).
function handleDoiAnchorClick(ops: ClickRoutingOps, doiAnchor: HTMLElement, e: MouseEvent): boolean {
  if (!ops.onDoiClick) return false;
  e.preventDefault();
  const href = doiAnchor.getAttribute('href') ?? '';
  const doi = href.replace(/^https:\/\/doi\.org\//, '');
  if (doi) ops.onDoiClick(doi);
  return true;
}

// Internal anchor click (footnote ref ↔ body, heading anchor jumps,
// etc.). The browser's native handling would scroll instantly and
// also tack `#fn1` onto the URL hash — neither great for an
// Electron renderer where the URL is `file:` or `chrome-error:`.
// Intercept, smooth-scroll the matching id into view, no hash
// mutation.
function handleInternalAnchorClick(ops: ClickRoutingOps, anchorEl: HTMLElement, e: MouseEvent): boolean {
  const href = anchorEl.getAttribute('href') ?? '';
  const id = href.slice(1);
  if (id) {
    const previewEl = ops.getPreviewEl();
    const target = previewEl?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Brief highlight so the user's eye locks onto the landing
      // spot — especially useful for footnote bodies that may be
      // visually adjacent to their neighbors.
      target.classList.add('anchor-landing');
      setTimeout(() => target.classList.remove('anchor-landing'), 1200);
    }
  }
  return true;
}

// ── Run-fence-from-preview handler ─────────────────────────────────────────
//
// Click on a ▶ run button on a python/sparql/sql code fence. We
// locate the fence by its opening-line number in the source
// markdown (markdown-it stamped it onto the fence-block wrapper),
// call the host's `onRunCell` (same trust-gated wrapper the editor
// uses), splice the resulting output fence block into
// the doc via the shared `planOutputEdit` helper, and hand the new
// full content back through `onApplyCellOutputEdit`. The host
// routes it through the editor's `setContent` so the edit shows up
// in undo history, autosave, and the dirty-state indicator just
// like a typed change.
//
// The whole pipeline lives in the editor side too — sharing
// `findRunnableFences` / `codeOf` / `planOutputEdit` from
// `editor/output-block.ts` means a run from preview and a run from
// the editor gutter produce bit-identical doc edits.
export async function runFenceAt(ops: ClickRoutingOps, openingLine: number): Promise<void> {
  const content = ops.getContent();
  const notePath = ops.getNotePath();
  if (!ops.onRunCell || !ops.onApplyCellOutputEdit || !notePath) return;
  const runningFences = ops.getRunningFences();
  if (runningFences.has(openingLine)) return;
  // Locate the fence in the live content. We could trust the line
  // number from markdown-it, but the doc may have been edited since
  // last render — re-scanning is cheap and rules out stale-token
  // bugs.
  const fences = findRunnableFences(content, RUNNABLE_LANGUAGE_SET);
  const fence = fences.find((f) => f.openingLine === openingLine);
  if (!fence) {
    logger('preview').warn(`runFenceAt: no fence at line ${openingLine}`);
    return;
  }
  const code = codeOf(content, fence);
  runningFences.add(openingLine);
  try {
    const result = await ops.onRunCell(fence.language, code, notePath);
    const edit = planOutputEdit(content, fence, result);
    const newContent = content.slice(0, edit.from) + edit.insert + content.slice(edit.to);
    ops.onApplyCellOutputEdit(newContent);
  } catch (e) {
    logger('preview').warn('runFenceAt failed:', e);
  } finally {
    runningFences.delete(openingLine);
  }
}

/**
 * Re-run every runnable fence in the note, top to bottom — the
 * preview-mode counterpart to the editor's Run-all, so the toolbar
 * button works when no editor is mounted. The sequential/stop-on-error
 * loop lives in `runAllCellsInContent`; here we just wire it to the
 * host's run + apply callbacks and the per-cell running indicator.
 */
export async function runAllCells(ops: ClickRoutingOps): Promise<void> {
  const content = ops.getContent();
  const notePath = ops.getNotePath();
  if (!ops.onRunCell || !ops.onApplyCellOutputEdit || !notePath) return;
  const runCell = ops.onRunCell;
  const apply = ops.onApplyCellOutputEdit;
  const runningFences = ops.getRunningFences();
  await runAllCellsInContent(content, RUNNABLE_LANGUAGE_SET, {
    runCell: (language, code) => runCell(language, code, notePath),
    apply,
    setRunning: (line, running) => {
      if (running) runningFences.add(line);
      else runningFences.delete(line);
    },
  });
}
