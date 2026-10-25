// A plugin's logic, run in its worker host (#2830) by tests/e2e/plugin-worker-host.spec.ts.
// Each handler exercises one guarantee: data in and out, the scope, what a
// worker can't reach, a handler that throws, one registered late, and a loop.
import { connect } from '/@minerva/plugin-api.js';

const minerva = await connect();

minerva.handle('echo', (args) => ({ echoed: args }));

minerva.handle('readNote', async ({ path }) => {
  const note = await minerva.notes.read({ path });
  return { path: note.path, length: note.content.length };
});

minerva.handle('probe', async () => {
  let fetched;
  try {
    await fetch('https://example.com/');
    fetched = 'ALLOWED';
  } catch (e) {
    fetched = `blocked: ${e.name}`;
  }
  let importFs;
  try {
    await import('node:fs');
    importFs = 'LOADED';
  } catch (e) {
    importFs = `blocked: ${e.name}`;
  }
  // A socket out (#2832): the origin's CSP has no connect-src for one.
  const websocket = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve('blocked: no answer'), 3000);
    try {
      const ws = new WebSocket('wss://example.com/leak');
      ws.onopen = () => { clearTimeout(timer); resolve('OPEN'); };
      ws.onerror = () => { clearTimeout(timer); resolve('blocked'); };
    } catch (e) {
      clearTimeout(timer);
      resolve(`blocked: ${e.name}`);
    }
  });
  return {
    require: typeof globalThis.require,
    process: typeof globalThis.process,
    document: typeof globalThis.document,
    api: typeof globalThis.api,
    fetched,
    importFs,
    websocket,
  };
});

minerva.handle('fails', () => { throw new Error('the parser choked on line 3'); });

minerva.handle('spin', () => { for (;;) { /* never answers */ } });

// Registered after an await: a call made before then waits for it.
await new Promise((r) => setTimeout(r, 300));
minerva.handle('late', () => 'late but here');
