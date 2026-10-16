// A minimal stdio MCP server, with no dependencies: newline-delimited
// JSON-RPC on stdin/stdout. A real plugin would use the MCP SDK.
'use strict';
const readline = require('node:readline');

const TOOLS = [
  {
    name: 'count_words',
    description: 'Count the words in a piece of text.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'greet',
    description: 'Say the configured greeting to someone, and whether an API token is set.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
];

function send(message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
}

function call(name, args) {
  if (name === 'count_words') {
    const words = String(args.text ?? '').trim().split(/\s+/).filter(Boolean).length;
    return { content: [{ type: 'text', text: String(words) }] };
  }
  if (name === 'greet') {
    const greeting = process.env.WORD_TOOLS_GREETING || 'Hello';
    const token = process.env.WORD_TOOLS_TOKEN ? 'set' : 'not set';
    return { content: [{ type: 'text', text: `${greeting}, ${String(args.name ?? '')}. (API token: ${token})` }] };
  }
  return { content: [{ type: 'text', text: `No tool "${name}".` }], isError: true };
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === undefined) return; // a notification
  switch (msg.method) {
    case 'initialize':
      send({ id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'word-tools', version: '1.0.0' } } });
      break;
    case 'tools/list':
      send({ id: msg.id, result: { tools: TOOLS } });
      break;
    case 'tools/call':
      send({ id: msg.id, result: call(msg.params?.name, msg.params?.arguments ?? {}) });
      break;
    default:
      send({ id: msg.id, error: { code: -32601, message: `Unknown method ${msg.method}` } });
  }
});
