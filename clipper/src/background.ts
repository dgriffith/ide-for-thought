/**
 * Service worker — the one-click capture-and-save path (#792).
 *
 * Triggered by the toolbar action click or the keyboard command. Captures the
 * active tab's rendered HTML + selection (via `scripting.executeScript`, gated
 * by `activeTab` so no broad host access is needed to read pages), then POSTs
 * from here — the service worker, whose `chrome-extension://` Origin the app
 * endpoint accepts. A badge flashes the outcome.
 */

import { loadPairing } from './pairing-store';
import { sendClip } from './ingest';
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

async function captureActiveTab(): Promise<ClipPayload | null> {
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

async function flashBadge(text: string, color: string): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => { void chrome.action.setBadgeText({ text: '' }); }, 3000);
}

async function saveCurrentPage(): Promise<void> {
  const pairing = await loadPairing();
  if (!pairing) {
    await flashBadge('?', '#888888');
    await chrome.runtime.openOptionsPage();
    return;
  }
  const payload = await captureActiveTab();
  if (!payload) {
    await flashBadge('!', '#cc3333');
    return;
  }
  const result = await sendClip(pairing, payload);
  if (result.ok) {
    await flashBadge('✓', '#22aa22');
  } else {
    await flashBadge('!', '#cc3333');
    console.error('[minerva-clipper]', result.error);
  }
}

chrome.action.onClicked.addListener(() => { void saveCurrentPage(); });
chrome.commands.onCommand.addListener((command) => {
  if (command === 'save-to-minerva') void saveCurrentPage();
});
