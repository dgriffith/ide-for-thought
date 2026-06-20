/**
 * Options page — pair the extension with a running Minerva (#791/#792):
 * paste the pairing code, test the connection, unpair.
 */

import { savePairingCode, loadPairing, clearPairing } from './pairing-store';
import { ping } from './ingest';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
}

const codeInput = el<HTMLTextAreaElement>('code');
const statusEl = el<HTMLParagraphElement>('status');

function setStatus(msg: string): void {
  statusEl.textContent = msg;
}

async function refresh(): Promise<void> {
  const pairing = await loadPairing();
  setStatus(pairing ? `Paired — port ${pairing.port}.` : 'Not paired.');
}

el<HTMLButtonElement>('pair').addEventListener('click', () => {
  void (async () => {
    const pairing = await savePairingCode(codeInput.value);
    if (!pairing) {
      setStatus('That doesn’t look like a valid pairing code.');
      return;
    }
    codeInput.value = '';
    setStatus(`Paired — port ${pairing.port}.`);
  })();
});

el<HTMLButtonElement>('test').addEventListener('click', () => {
  void (async () => {
    const pairing = await loadPairing();
    if (!pairing) {
      setStatus('Pair first.');
      return;
    }
    const result = await ping(pairing);
    if (!result.ok) setStatus(`Connection failed: ${result.error}`);
    else setStatus(result.projectOpen ? 'Connected — a thoughtbase is open.' : 'Connected, but no thoughtbase is open.');
  })();
});

el<HTMLButtonElement>('unpair').addEventListener('click', () => {
  void (async () => {
    await clearPairing();
    setStatus('Unpaired.');
  })();
});

void refresh();
