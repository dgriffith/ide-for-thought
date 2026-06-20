/**
 * Capture the active tab's rendered HTML + selection (#792/#793). Shared by the
 * service worker (instant save via the keyboard command) and the popup
 * (curate-before-save). Uses `scripting.executeScript` gated by `activeTab`, so
 * no broad host permission is needed to read the page.
 */

import { normalizeSelection, type ClipPayload } from './payload';

/**
 * Runs in the page context (serialized by executeScript) — must be
 * self-contained, referencing only page globals.
 */
function capturePage() {
  return {
    url: location.href,
    html: document.documentElement.outerHTML,
    pageTitle: document.title,
    selection: window.getSelection()?.toString() ?? '',
  };
}

/** Capture the active tab, or null when there's no scriptable tab. */
export async function captureActiveTab(): Promise<ClipPayload | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  const [injected] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: capturePage,
  });
  const r = injected?.result as
    | { url: string; html: string; pageTitle: string; selection: string }
    | undefined;
  if (!r?.html) return null;
  return {
    url: r.url,
    html: r.html,
    pageTitle: r.pageTitle,
    selection: normalizeSelection(r.selection),
  };
}
