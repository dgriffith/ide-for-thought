/**
 * Service worker — the instant capture-and-save path (#792).
 *
 * The toolbar button now opens the popup (curate-before-save, #793), so the
 * one-click path here is driven by the keyboard command: capture the active
 * tab and POST from the service worker (whose `chrome-extension://` Origin the
 * app endpoint accepts), flashing a badge with the outcome. The popup handles
 * the click; this keeps the no-UI shortcut.
 */

import { loadPairing } from './pairing-store';
import { sendClip } from './ingest';
import { captureActiveTab } from './capture';

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

chrome.commands.onCommand.addListener((command) => {
  if (command === 'save-to-minerva') void saveCurrentPage();
});
