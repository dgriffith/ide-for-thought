// The __PLUGIN_ID__ MCP server: newline-delimited JSON-RPC on stdin/stdout,
// with no dependencies. Minerva starts it with `node server/index.js` in the
// plugin folder, once you switch it on in Settings → MCP Servers.
//
// Two tools, one of each kind Minerva treats differently:
// - list_memos is marked readOnlyHint, so the assistant may call it freely;
// - add_memo writes, so Minerva asks in the conversation before each call.
//
// Replace them with your own. The protocol code below can stay as it is, or
// you can move to the MCP SDK (@modelcontextprotocol/sdk) once you need more.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const SERVER = { name: '__PLUGIN_ID__', version: '0.1.0' };
const PROTOCOL_VERSION = '2025-06-18';

// The plugin's "memoFile" setting arrives as MEMO_FILE (see plugin.json).
function memoFile() {
  return process.env.MEMO_FILE || path.join(os.homedir(), '.__PLUGIN_ID__', 'memos.jsonl');
}

function readMemos() {
  let text;
  try {
    text = fs.readFileSync(memoFile(), 'utf-8');
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

const TOOLS = [
  {
    name: 'list_memos',
    description: 'List the saved memos, newest last.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    run() {
      const memos = readMemos();
      return memos.length === 0
        ? 'No memos yet.'
        : memos.map((m) => `- ${m.text} (${m.at})`).join('\n');
    },
  },
  {
    name: 'add_memo',
    description: 'Save a short memo.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'The memo.' } },
      required: ['text'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    run(args) {
      const text = typeof args.text === 'string' ? args.text.trim() : '';
      if (!text) throw new Error('"text" must be a non-empty string.');
      const file = memoFile();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, JSON.stringify({ text, at: new Date().toISOString() }) + '\n');
      return `Saved: ${text}`;
    },
  },
];

function send(message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
}

function callTool(name, args) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { content: [{ type: 'text', text: `No tool "${name}".` }], isError: true };
  try {
    return { content: [{ type: 'text', text: tool.run(args ?? {}) }] };
  } catch (e) {
    // A tool's failure is a result the model reads, not a protocol error.
    return { content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true };
  }
}

function handle(msg) {
  switch (msg.method) {
    case 'initialize':
      return { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: TOOLS.map(({ run: _run, ...tool }) => tool) };
    case 'tools/call':
      return callTool(msg.params?.name, msg.params?.arguments);
    default:
      return undefined;
  }
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    send({ id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  if (msg.id === undefined || msg.id === null) return; // a notification
  const result = handle(msg);
  if (result === undefined) send({ id: msg.id, error: { code: -32601, message: `Unknown method ${msg.method}` } });
  else send({ id: msg.id, result });
});
