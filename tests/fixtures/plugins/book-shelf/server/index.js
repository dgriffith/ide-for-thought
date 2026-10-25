// Book Shelf's MCP server: a stand-in for a site with an API. A real plugin
// would fetch https://books.example/api/…; this one answers from a catalogue
// it carries, so it runs offline. Minerva hands `read_book` what the user
// gave it (a page's URL, or a shelf:<id>), and it answers a source draft as
// JSON: { title, body, type, creators, issued, publisher, abstract, uri }.
'use strict';
const readline = require('node:readline');

const CATALOGUE = {
  '42': {
    title: 'The Hitchhiker’s Guide to the Galaxy',
    creators: ['Douglas Adams'],
    issued: '1979',
    publisher: 'Pan Books',
    abstract: 'Seconds before Earth is demolished, Arthur Dent is whisked off it by a friend.',
    body: '# The Hitchhiker’s Guide to the Galaxy\n\nFar out in the uncharted backwaters of the unfashionable end of the western spiral arm of the Galaxy lies a small unregarded yellow sun.\n',
  },
};

const TOOLS = [{
  name: 'read_book',
  description: 'Read a book from the Book Shelf catalogue, by its page URL or its shelf id, as a source.',
  inputSchema: { type: 'object', properties: { ingestor: { type: 'string' }, url: { type: 'string' }, identifier: { type: 'string' } } },
  annotations: { readOnlyHint: true },
}, {
  name: 'find_book',
  description: 'Find the selected words in the Book Shelf catalogue: a command, answering what to say.',
  inputSchema: { type: 'object', properties: { command: { type: 'string' }, note: { type: 'string' }, selection: { type: 'string' } } },
  annotations: { readOnlyHint: true },
}];

function send(message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
}

function readBook(args) {
  const id = args.url ? /\/books?\/(\d+)/.exec(new URL(args.url).pathname)?.[1] : /^shelf:(\d+)$/i.exec(String(args.identifier ?? ''))?.[1];
  const book = id && CATALOGUE[id];
  if (!book) return { content: [{ type: 'text', text: `No book ${id ?? 'named'} on the shelf.` }], isError: true };
  const draft = { ...book, type: 'Book', uri: `https://books.example/books/${id}` };
  return { content: [{ type: 'text', text: JSON.stringify(draft) }] };
}

// A command's tool answers a command's result: what to announce, here.
function findBook(args) {
  const words = String(args.selection ?? '').trim().toLowerCase();
  const hit = Object.entries(CATALOGUE).find(([, b]) => words && b.title.toLowerCase().includes(words));
  const announce = hit ? `On the shelf: ${hit[1].title} (shelf:${hit[0]}).` : `Nothing on the shelf matches "${String(args.selection ?? '').trim()}".`;
  return { content: [{ type: 'text', text: JSON.stringify({ announce }) }] };
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === undefined) return;
  switch (msg.method) {
    case 'initialize':
      send({ id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'book-shelf', version: '1.0.0' } } });
      break;
    case 'tools/list':
      send({ id: msg.id, result: { tools: TOOLS } });
      break;
    case 'tools/call':
      send({ id: msg.id, result: msg.params?.name === 'read_book' ? readBook(msg.params.arguments ?? {})
        : msg.params?.name === 'find_book' ? findBook(msg.params.arguments ?? {})
          : { content: [{ type: 'text', text: `No tool "${msg.params?.name}".` }], isError: true } });
      break;
    default:
      send({ id: msg.id, error: { code: -32601, message: `Unknown method ${msg.method}` } });
  }
});
