/**
 * Toolbar popup — the curate-before-save path (#793). On open it captures the
 * active tab and asks the app for a source-id preview, then lets the user add
 * tags / a note before saving. The keyboard shortcut (handled in the service
 * worker) remains the no-UI instant-save path.
 */

import { loadPairing } from './pairing-store';
import { sendClip, preview } from './ingest';
import { captureActiveTab } from './capture';
import { parseTags, type ClipPayload } from './payload';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

const titleEl = el<HTMLDivElement>('title');
const previewEl = el<HTMLDivElement>('preview');
const selectionEl = el<HTMLDivElement>('selection');
const tagsInput = el<HTMLInputElement>('tags');
const noteInput = el<HTMLTextAreaElement>('note');
const saveBtn = el<HTMLButtonElement>('save');
const statusEl = el<HTMLSpanElement>('status');

function setStatus(msg: string): void { statusEl.textContent = msg; }

/** The captured page, held so Save reuses exactly what was previewed. */
let captured: ClipPayload | null = null;

async function init(): Promise<void> {
  const pairing = await loadPairing();
  if (!pairing) {
    titleEl.textContent = 'Not paired yet.';
    setStatus('');
    saveBtn.textContent = 'Pair…';
    saveBtn.disabled = false;
    saveBtn.addEventListener('click', () => { void chrome.runtime.openOptionsPage(); });
    return;
  }

  captured = await captureActiveTab();
  if (!captured) {
    titleEl.textContent = 'Can’t read this page.';
    return;
  }

  titleEl.textContent = captured.pageTitle || captured.url;
  selectionEl.textContent = captured.selection
    ? `Selection will be saved as an excerpt (${captured.selection.length} chars).`
    : '';
  saveBtn.disabled = false;
  saveBtn.addEventListener('click', () => { void save(pairing); });

  // Preview the canonical id in the background — non-blocking, best-effort.
  const p = await preview(pairing, { url: captured.url, html: captured.html });
  if (p.ok) {
    if (p.title) titleEl.textContent = p.title;
    previewEl.textContent = p.sourceId ? `id: ${p.sourceId}` : '';
  } else {
    previewEl.textContent = p.error ?? '';
  }
}

async function save(pairing: NonNullable<Awaited<ReturnType<typeof loadPairing>>>): Promise<void> {
  if (!captured) return;
  saveBtn.disabled = true;
  setStatus('Saving…');
  const tags = parseTags(tagsInput.value);
  const note = noteInput.value.trim();
  const result = await sendClip(pairing, {
    ...captured,
    tags: tags.length ? tags : undefined,
    note: note || undefined,
  });
  if (result.ok) {
    setStatus(result.duplicate ? 'Updated ✓' : 'Saved ✓');
    setTimeout(() => window.close(), 700);
  } else {
    setStatus(result.error ?? 'Failed');
    saveBtn.disabled = false;
  }
}

void init();
