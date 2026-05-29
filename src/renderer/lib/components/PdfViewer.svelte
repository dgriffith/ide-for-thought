<script lang="ts">
  /**
   * In-app PDF viewer (#100). Single-page at-a-time renderer over
   * pdfjs-dist with text-layer selection, page navigation, zoom, and
   * an overlay of existing Excerpts as highlights.
   *
   * pdfjs is dynamic-imported on mount — the library + worker is
   * ~3 MB, and most sessions don't touch a PDF tab. Importing on
   * mount keeps the rest of the app fast.
   *
   * Excerpt highlights use citedText search rather than stored
   * coordinates (per the #100 design). Walking the page's text layer
   * for substring matches works for the common case; misses excerpts
   * whose text was OCR-altered or spans a column break. Adding
   * explicit pdfBoundingBox to excerpts is a future-work refinement.
   */
  import { api } from '../ipc/client';
  import type { SourceExcerpt } from '../../../shared/types';
  import { getEditorStore } from '../stores/editor.svelte';
  import { clampMenuToViewport } from '../utils/menuClamp';
  // Worker URL has to be a *static* import — Vite's `?url` suffix is
  // resolved at build time. Inside `await import(...)` it falls
  // through to a regular ES module load and `.default` is undefined,
  // which is what produced "No GlobalWorkerOptions.workerSrc
  // specified" on first mount. The URL itself is a tiny string;
  // statically importing it doesn't load the worker until pdfjs
  // actually spawns it.
  import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

  // Loosely-typed pdfjs handles — we don't ship pdfjs's full types at
  // the call sites here and the dynamic import doesn't give us
  // namespaces. The API we touch is small and stable.
  type PdfjsModule = typeof import('pdfjs-dist');
  type PdfDocumentProxy = Awaited<ReturnType<PdfjsModule['getDocument']>['promise']>;
  type PdfPageProxy = Awaited<ReturnType<PdfDocumentProxy['getPage']>>;
  type TextContent = Awaited<ReturnType<PdfPageProxy['getTextContent']>>;
  type TextItem = TextContent['items'][number];

  interface Props {
    sourceId: string;
    /** 1-based initial page (from the saved PdfTab). */
    initialPage: number;
    /** Switch to the source-detail (extracted-markdown) view. The
     *  host opens a SourceTab and persists the user's preference. */
    onShowMarkdown: (sourceId: string) => void;
  }

  let { sourceId, initialPage, onShowMarkdown }: Props = $props();

  const editor = getEditorStore();

  let pdfjs = $state<PdfjsModule | null>(null);
  let doc = $state<PdfDocumentProxy | null>(null);
  let loadError = $state<string | null>(null);
  let loading = $state(true);

  let page = $state(initialPage);
  let numPages = $state(0);
  let scale = $state(1.2);
  const MIN_SCALE = 0.5;
  const MAX_SCALE = 3.0;
  const SCALE_STEP = 0.15;

  let canvasEl = $state<HTMLCanvasElement>();
  let textLayerEl = $state<HTMLDivElement>();
  let highlightLayerEl = $state<HTMLDivElement>();
  let viewerEl = $state<HTMLDivElement>();

  /** Excerpts for this source — loaded once and refreshed when the
   *  main process notifies that excerpts have changed. */
  let excerpts = $state<SourceExcerpt[]>([]);

  let excerptMenu = $state<{ x: number; y: number; text: string } | null>(null);
  let excerptMenuEl = $state<HTMLDivElement>();
  let recentSaved = $state<{ id: string; duplicate: boolean } | null>(null);
  let saving = $state(false);
  let saveError = $state<string | null>(null);

  /** Re-render whenever page, scale, or doc identity changes. */
  $effect(() => {
    page; scale; doc;
    if (doc) void renderPage();
  });

  $effect(() => {
    if (!excerptMenu || !excerptMenuEl) return;
    const next = clampMenuToViewport(excerptMenu.x, excerptMenu.y, excerptMenuEl);
    if (next.x !== excerptMenu.x || next.y !== excerptMenu.y) {
      excerptMenu = { ...excerptMenu, ...next };
    }
  });

  // ── Initial load ──────────────────────────────────────────────────────────

  $effect(() => {
    void mountDoc(sourceId);
  });

  async function mountDoc(id: string): Promise<void> {
    loading = true;
    loadError = null;
    try {
      if (!pdfjs) {
        // The 'legacy' build ships the polyfills pdfjs v5 needs for
        // browsers that don't yet implement Uint8Array.prototype.toHex
        // (a Stage 3 TC39 proposal). Electron 35 is on Chromium 134;
        // toHex landed in Chromium 140. The OCR runner gets away with
        // the main build because it doesn't trigger the fingerprint
        // path that calls toHex; the viewer does.
        pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      }
      const bytes = await api.sources.readPdf(id);
      const newDoc = await pdfjs.getDocument({ data: bytes }).promise;
      if (doc) void doc.destroy();
      doc = newDoc;
      numPages = newDoc.numPages;
      if (page > numPages) page = numPages;
      if (page < 1) page = 1;
      // Refresh the excerpts list against the new source.
      await refreshExcerpts(id);
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  async function refreshExcerpts(id: string): Promise<void> {
    try {
      const detail = await api.graph.sourceDetail(id);
      excerpts = detail?.excerpts ?? [];
    } catch {
      excerpts = [];
    }
  }

  // Listen for excerpt-changed broadcasts so newly-saved excerpts
  // appear as highlights immediately.
  api.sources.onExcerptsChanged(() => {
    void refreshExcerpts(sourceId);
  });

  // ── Render a page ─────────────────────────────────────────────────────────

  async function renderPage(): Promise<void> {
    if (!doc || !canvasEl || !textLayerEl || !highlightLayerEl) return;
    const pageObj = await doc.getPage(page);
    const viewport = pageObj.getViewport({ scale });

    canvasEl.width = Math.floor(viewport.width);
    canvasEl.height = Math.floor(viewport.height);
    canvasEl.style.width = `${Math.floor(viewport.width)}px`;
    canvasEl.style.height = `${Math.floor(viewport.height)}px`;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    await pageObj.render({ canvasContext: ctx, viewport, canvas: canvasEl }).promise;

    // Text layer — paint absolutely-positioned spans so selection works
    // against the underlying canvas. Each span carries the original
    // textContent item's geometry so the highlight-finder can compute
    // bounding boxes for excerpt matches.
    const text = await pageObj.getTextContent();
    paintTextLayer(text, viewport);

    // Paint excerpt highlights for the current page.
    paintExcerptHighlights(text, viewport);

    pageObj.cleanup();

    // Tell the store the user landed on a (possibly new) page so the
    // saved tab state restores them here next session.
    editor.setPdfPage(sourceId, page);
  }

  function paintTextLayer(text: TextContent, viewport: { width: number; height: number; transform: number[] }): void {
    if (!textLayerEl) return;
    textLayerEl.style.width = `${viewport.width}px`;
    textLayerEl.style.height = `${viewport.height}px`;
    textLayerEl.replaceChildren();

    for (const it of text.items) {
      if (!('str' in it)) continue;
      const item = it as TextItem & { str: string; transform: number[]; width: number; height: number };
      const span = document.createElement('span');
      span.textContent = item.str;
      const { left, top, fontSize } = itemPosition(item, viewport);
      span.style.position = 'absolute';
      span.style.left = `${left}px`;
      span.style.top = `${top}px`;
      span.style.fontSize = `${fontSize}px`;
      span.style.transformOrigin = '0% 0%';
      // pdfjs gives us widths in unscaled units; setting only fontSize
      // makes spans visually match the rendered text without us
      // shipping the original font, since we use a transparent fill
      // anyway — selection geometry is what we actually need here.
      span.dataset.itemIdx = String(text.items.indexOf(it));
      textLayerEl.appendChild(span);
    }
  }

  function itemPosition(
    item: { transform: number[]; width: number; height: number },
    viewport: { width: number; height: number; transform: number[] },
  ): { left: number; top: number; fontSize: number } {
    // pdfjs page coordinates have origin at bottom-left; viewport
    // transform flips Y and applies the user scale. Compose item's
    // text matrix with the viewport transform to land in CSS pixels.
    const t = item.transform;
    const v = viewport.transform;
    // Affine compose: out = v ∘ t
    const a = v[0] * t[0] + v[2] * t[1];
    const b = v[1] * t[0] + v[3] * t[1];
    const e = v[0] * t[4] + v[2] * t[5] + v[4];
    const f = v[1] * t[4] + v[3] * t[5] + v[5];
    const fontSize = Math.hypot(a, b);
    return { left: e, top: f - fontSize, fontSize };
  }

  // ── Excerpt highlight overlay ─────────────────────────────────────────────

  function paintExcerptHighlights(
    text: TextContent,
    viewport: { width: number; height: number; transform: number[] },
  ): void {
    if (!highlightLayerEl) return;
    highlightLayerEl.style.width = `${viewport.width}px`;
    highlightLayerEl.style.height = `${viewport.height}px`;
    highlightLayerEl.replaceChildren();

    // Build a flat string of the page text plus a parallel
    // index-of-each-character → text-item map so we can map a match
    // range back to spans and their bounding boxes.
    const pageText: string[] = [];
    const charToItem: number[] = [];
    text.items.forEach((it, idx) => {
      if (!('str' in it)) return;
      const s = (it as TextItem & { str: string }).str;
      for (const ch of s) {
        pageText.push(ch);
        charToItem.push(idx);
      }
      // Trailing space to keep word boundaries when items are
      // adjacent without intervening whitespace.
      pageText.push(' ');
      charToItem.push(idx);
    });
    const haystack = pageText.join('');
    const haystackNorm = normalizeForMatch(haystack);

    for (const e of excerpts) {
      // Page constraint: if the excerpt knows its page, skip when
      // it's not the current one. No page hint → still try matching.
      // `page` from SourceExcerpt is the TTL-serialised string form;
      // an int compare needs a parse first.
      if (e.page != null) {
        const ep = parseInt(e.page, 10);
        if (Number.isFinite(ep) && ep !== page) continue;
      }
      if (!e.citedText) continue;
      const needle = normalizeForMatch(e.citedText);
      if (!needle) continue;
      const start = haystackNorm.indexOf(needle);
      if (start < 0) continue;
      const end = start + needle.length;

      // Resolve back to the set of text-content items the match spans
      // and compute their union bounding box. itemRects gives us each
      // contributing item's box; for a single-item match this is one
      // rectangle, for multi-line we get a stacked set.
      const itemSet = new Set<number>();
      for (let i = start; i < end && i < charToItem.length; i++) {
        itemSet.add(charToItem[i]);
      }
      for (const idx of itemSet) {
        const it = text.items[idx] as TextItem & { transform: number[]; width: number; height: number };
        if (!('str' in it)) continue;
        const { left, top, fontSize } = itemPosition(it, viewport);
        const width = it.width * scale;
        const hl = document.createElement('div');
        hl.className = 'pdf-excerpt-hl';
        hl.style.left = `${left}px`;
        hl.style.top = `${top}px`;
        hl.style.width = `${width}px`;
        hl.style.height = `${fontSize * 1.15}px`;
        hl.title = `Excerpt ${e.excerptId}`;
        highlightLayerEl.appendChild(hl);
      }
    }
  }

  /** Normalize whitespace + zero-width chars so the search is robust
   *  against PDF's hyphenation / soft-line-break noise. Soft hyphen
   *  (U+00AD), zero-width space (U+200B), zero-width non-joiner
   *  (U+200C) get stripped — they're invisible noise that PDFs love. */
  function normalizeForMatch(s: string): string {
    return s
      .replace(/\s+/g, ' ')
      .replace(/[\u00AD\u200B\u200C]/g, '')
      .trim()
      .toLowerCase();
  }

  // ── Selection → Save as Excerpt ───────────────────────────────────────────

  function handleContextMenu(e: MouseEvent): void {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';
    if (!text) return; // No selection — allow native menu
    e.preventDefault();
    excerptMenu = { x: e.clientX, y: e.clientY, text };
    saveError = null;
    const close = () => {
      excerptMenu = null;
      window.removeEventListener('click', close);
    };
    setTimeout(() => window.addEventListener('click', close), 0);
  }

  async function saveExcerpt(): Promise<void> {
    if (!excerptMenu) return;
    const citedText = excerptMenu.text;
    saving = true;
    saveError = null;
    try {
      const result = await api.sources.createExcerpt({ sourceId, citedText, page });
      recentSaved = { id: result.excerptId, duplicate: result.duplicate };
      excerptMenu = null;
      await refreshExcerpts(sourceId);
      setTimeout(() => { recentSaved = null; }, 3500);
    } catch (err) {
      saveError = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  function prevPage(): void { if (page > 1) page--; }
  function nextPage(): void { if (page < numPages) page++; }
  function zoomIn(): void { scale = Math.min(MAX_SCALE, +(scale + SCALE_STEP).toFixed(2)); }
  function zoomOut(): void { scale = Math.max(MIN_SCALE, +(scale - SCALE_STEP).toFixed(2)); }
  function zoomReset(): void { scale = 1.2; }

  function handleKey(e: KeyboardEvent): void {
    // Ignore when typing into a text field — page jump input belongs to itself.
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'PageDown' || e.key === 'ArrowRight') { e.preventDefault(); nextPage(); }
    else if (e.key === 'PageUp' || e.key === 'ArrowLeft') { e.preventDefault(); prevPage(); }
    else if (e.key === 'Home') { e.preventDefault(); page = 1; }
    else if (e.key === 'End') { e.preventDefault(); page = numPages; }
    else if ((e.metaKey || e.ctrlKey) && e.key === '=') { e.preventDefault(); zoomIn(); }
    else if ((e.metaKey || e.ctrlKey) && e.key === '-') { e.preventDefault(); zoomOut(); }
    else if ((e.metaKey || e.ctrlKey) && e.key === '0') { e.preventDefault(); zoomReset(); }
  }

  function pageInputChange(e: Event): void {
    const v = parseInt((e.target as HTMLInputElement).value, 10);
    if (Number.isFinite(v) && v >= 1 && v <= numPages) page = v;
  }
</script>

<svelte:window onkeydown={handleKey} />

<div class="pdf-viewer" bind:this={viewerEl}>
  <div class="toolbar">
    <button type="button" class="tool-btn" onclick={prevPage} disabled={page <= 1} title="Previous page">‹</button>
    <span class="page-counter">
      <input
        type="number"
        class="page-input"
        min="1"
        max={numPages}
        value={page}
        onchange={pageInputChange}
      />
      / {numPages}
    </span>
    <button type="button" class="tool-btn" onclick={nextPage} disabled={page >= numPages} title="Next page">›</button>
    <span class="spacer"></span>
    <button type="button" class="tool-btn" onclick={zoomOut} disabled={scale <= MIN_SCALE} title="Zoom out">−</button>
    <span class="zoom-label">{Math.round(scale * 100)}%</span>
    <button type="button" class="tool-btn" onclick={zoomIn} disabled={scale >= MAX_SCALE} title="Zoom in">+</button>
    <button type="button" class="tool-btn small" onclick={zoomReset} title="Reset zoom">Fit</button>
    <button type="button" class="tool-btn small" onclick={() => onShowMarkdown(sourceId)} title="Show the extracted text view">Show extracted</button>
  </div>

  <div class="scroll-area">
    {#if loading}
      <div class="status">Loading PDF…</div>
    {:else if loadError}
      <div class="status error">Failed to load PDF: {loadError}</div>
    {:else}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="page-stage" oncontextmenu={handleContextMenu}>
        <canvas bind:this={canvasEl}></canvas>
        <div class="text-layer" bind:this={textLayerEl}></div>
        <div class="highlight-layer" bind:this={highlightLayerEl}></div>
      </div>
    {/if}
  </div>

  {#if excerptMenu}
    <div class="context-menu" bind:this={excerptMenuEl} style:left="{excerptMenu.x}px" style:top="{excerptMenu.y}px">
      <button type="button" disabled={saving} onclick={() => { void saveExcerpt(); }}>
        {saving ? 'Saving…' : `Save as excerpt (p. ${page})`}
      </button>
      {#if saveError}
        <div class="menu-error">{saveError}</div>
      {/if}
    </div>
  {/if}

  {#if recentSaved}
    <div class="toast" class:dup={recentSaved.duplicate}>
      {recentSaved.duplicate ? 'Excerpt already exists' : 'Excerpt saved'}
    </div>
  {/if}
</div>

<style>
  .pdf-viewer {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg);
    color: var(--text);
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-sidebar);
    flex-shrink: 0;
  }
  .spacer { flex: 1; }
  .tool-btn {
    padding: 3px 9px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--bg);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 13px;
    cursor: pointer;
    min-width: 26px;
  }
  .tool-btn.small { font-family: var(--font-sans); font-size: 11.5px; }
  .tool-btn:hover:not(:disabled) {
    color: var(--text);
    border-color: var(--border-strong);
  }
  .tool-btn:disabled { opacity: 0.4; cursor: default; }
  .page-counter {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-muted);
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .page-input {
    width: 48px;
    padding: 2px 4px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 12px;
    text-align: right;
  }
  .zoom-label {
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--text-muted);
    min-width: 40px;
    text-align: center;
  }

  .scroll-area {
    flex: 1;
    overflow: auto;
    display: flex;
    justify-content: center;
    padding: 16px;
  }
  .status {
    color: var(--text-muted);
    padding: 24px;
    font-size: 13px;
  }
  .status.error { color: var(--text); }

  .page-stage {
    position: relative;
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.25);
    background: white;
  }
  .page-stage canvas {
    display: block;
  }
  /* Text layer overlays the canvas so selection geometry matches the
     rendered glyphs. Transparent fill — the canvas underneath is what
     the user sees, but the spans capture selection. */
  .text-layer {
    position: absolute;
    inset: 0;
    color: transparent;
    line-height: 1;
    overflow: hidden;
    user-select: text;
  }
  .text-layer :global(span) {
    position: absolute;
    white-space: pre;
    cursor: text;
    transform-origin: 0% 0%;
  }
  .text-layer :global(::selection) {
    background: color-mix(in oklch, var(--accent) 35%, transparent);
  }

  .highlight-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .highlight-layer :global(.pdf-excerpt-hl) {
    position: absolute;
    background: color-mix(in oklch, var(--accent) 25%, transparent);
    border-radius: 2px;
    pointer-events: auto;
    cursor: pointer;
  }

  .context-menu {
    position: fixed;
    z-index: 1500;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 0;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    min-width: 180px;
  }
  .context-menu button {
    display: block;
    width: 100%;
    padding: 6px 12px;
    border: none;
    background: none;
    color: var(--text);
    font-size: 12.5px;
    cursor: pointer;
    text-align: left;
  }
  .context-menu button:hover:not(:disabled) { background: var(--bg-button); }
  .menu-error {
    padding: 4px 12px;
    color: var(--text-muted);
    font-size: 11px;
  }

  .toast {
    position: absolute;
    bottom: 16px;
    right: 16px;
    padding: 6px 12px;
    background: var(--bg-sidebar);
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    color: var(--text);
    font-size: 12px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }
  .toast.dup { color: var(--text-muted); }
</style>
