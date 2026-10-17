// Drives the server over stdio, the way Minerva does. Run with `npm test`
// (or `node --test`) in the plugin folder.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

function startServer(env) {
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const waiting = new Map();
  readline.createInterface({ input: proc.stdout }).on('line', (line) => {
    const msg = JSON.parse(line);
    waiting.get(msg.id)?.(msg);
    waiting.delete(msg.id);
  });
  let nextId = 1;
  return {
    request(method, params) {
      const id = nextId++;
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      return new Promise((resolve) => waiting.set(id, resolve));
    },
    notify(method) {
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
    },
    stop() {
      proc.kill();
    },
  };
}

test('the server lists its tools and runs them', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memos-'));
  const server = startServer({ MEMO_FILE: path.join(dir, 'memos.jsonl') });
  t.after(() => {
    server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const init = await server.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  server.notify('notifications/initialized');

  const { result: { tools } } = await server.request('tools/list', {});
  assert.deepEqual(tools.map((tool) => [tool.name, tool.annotations.readOnlyHint]), [['list_memos', true], ['add_memo', false]]);

  const empty = await server.request('tools/call', { name: 'list_memos', arguments: {} });
  assert.equal(empty.result.content[0].text, 'No memos yet.');

  const saved = await server.request('tools/call', { name: 'add_memo', arguments: { text: 'Buy milk' } });
  assert.equal(saved.result.content[0].text, 'Saved: Buy milk');

  const listed = await server.request('tools/call', { name: 'list_memos', arguments: {} });
  assert.match(listed.result.content[0].text, /^- Buy milk \(/);

  const bad = await server.request('tools/call', { name: 'add_memo', arguments: { text: '  ' } });
  assert.equal(bad.result.isError, true);

  const unknown = await server.request('nope', {});
  assert.equal(unknown.error.code, -32601);
});
