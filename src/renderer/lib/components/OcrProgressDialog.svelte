<script lang="ts">
  /**
   * Two-stage dialog for the scanned-PDF OCR flow (#95):
   *   1. Confirm — shows page count + time estimate, user opts in.
   *   2. Progress — shows "Page N of M" with a bar as Tesseract runs.
   *
   * Runs `runOcr` via an AbortController so Cancel actually halts
   * between pages. On success, calls `onDone(pages)` — the caller
   * forwards the text to main via `api.sources.finishPdfOcr`.
   */
  import { runOcr, type OcrProgress } from '../ocr/run-ocr';

  interface Props {
    pdfBytes: Uint8Array;
    pageCount: number;
    title: string;
    onDone: (pages: string[]) => void;
    onCancel: () => void;
  }

  let { pdfBytes, pageCount, title, onDone, onCancel }: Props = $props();

  // Rough estimate — ~3s/page on a modern laptop at 2× scale. Users
  // with huge scans will see the real rate once it starts.
  const estSecondsPerPage = 3;
  const totalEstSeconds = pageCount * estSecondsPerPage;

  type Stage = 'confirm' | 'running' | 'error';
  let stage = $state<Stage>('confirm');
  let progress = $state<OcrProgress | null>(null);
  let errorMsg = $state<string | null>(null);
  let controller: AbortController | null = null;

  function formatDuration(seconds: number): string {
    if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
    const mins = Math.ceil(seconds / 60);
    return `${mins} min`;
  }

  async function start() {
    stage = 'running';
    controller = new AbortController();
    try {
      const pages = await runOcr(pdfBytes, (p) => { progress = p; }, controller.signal);
      onDone(pages);
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') {
        onCancel();
        return;
      }
      stage = 'error';
      errorMsg = err instanceof Error ? err.message : String(err);
    }
  }

  function cancel() {
    if (controller) controller.abort();
    else onCancel();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    if (e.key === 'Enter' && stage === 'confirm') { e.preventDefault(); void start(); }
  }

  const pct = $derived(
    progress
      ? ((progress.page - 1 + (progress.pageProgress ?? 0)) / progress.totalPages) * 100
      : 0,
  );
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onkeydown={handleKeydown}>
  <div class="dialog">
    {#if stage === 'confirm'}
      <h3 class="title">Run OCR on "{title}"?</h3>
      <p class="body">
        This PDF has no text layer. Running OCR will read each page as an
        image and extract text with Tesseract — slow but accurate.
      </p>
      <p class="stats">
        {pageCount} page{pageCount === 1 ? '' : 's'} · ~{formatDuration(totalEstSeconds)} estimated
      </p>
      <div class="actions">
        <button class="btn secondary" onclick={onCancel}>Skip</button>
        <button class="btn primary" onclick={start}>Run OCR</button>
      </div>
    {:else if stage === 'running'}
      <h3 class="title">Running OCR…</h3>
      <p class="body">
        {progress
          ? `Page ${progress.page} of ${progress.totalPages}`
          : 'Loading PDF…'}
      </p>
      <div class="progress-track"><div class="progress-fill" style:width="{pct}%"></div></div>
      <div class="actions">
        <button class="btn secondary" onclick={cancel}>Cancel</button>
      </div>
    {:else}
      <h3 class="title">OCR failed</h3>
      <p class="body error">{errorMsg}</p>
      <div class="actions">
        <button class="btn primary" onclick={onCancel}>Close</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .dialog {
    min-width: 380px;
    max-width: 500px;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .title { margin: 0; font-size: 14px; color: var(--text); }
  .body { margin: 0; font-size: 13px; color: var(--text); }
  .body.error { color: var(--accent); }
  .stats { margin: 0; font-size: 12px; color: var(--text-muted); }
  .progress-track {
    width: 100%;
    height: 6px;
    background: var(--bg-button);
    border-radius: 3px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: var(--accent);
    transition: width 120ms linear;
  }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
  .btn {
    padding: 5px 14px;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
  }
  .secondary { background: var(--bg-button); color: var(--text); }
  .secondary:hover { background: var(--bg-button-hover); }
  .primary { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  .primary:hover { opacity: 0.9; }
</style>
