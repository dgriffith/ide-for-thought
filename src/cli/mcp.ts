/**
 * A minimal MCP server over stdio (#1146, epic #1145 — Substrate).
 *
 * The headline of the substrate vision: any external agent in the user's fleet —
 * a coding agent, a browser agent, Claude Desktop — can query the thoughtbase
 * through one protocol. This wraps the read `Engine` as MCP tools. It's a thin
 * envelope: the Engine already does the work; this speaks the wire.
 *
 * Hand-rolled rather than pulling in the MCP SDK — the read-only surface is a
 * handful of JSON-RPC 2.0 methods over newline-delimited stdio, and keeping it
 * dependency-free keeps the CLI bundle lean and the protocol handling testable
 * as a pure function. `handleMcpMessage` is that pure core; `runMcpServer` is the
 * stdio plumbing around it.
 *
 * Read-only by construction. Writes are a later child (#1147) and go through the
 * approval gate — an external agent proposes, the human confirms.
 */
import * as readline from 'node:readline';
import { type Engine, type EngineOptions, type ExecResult } from './engine';
import { createRoutedEngine } from './routed-engine';
import { jsonStringify } from './json';
import { projectContext } from '../main/project-context-types';

/** Protocol version we speak. We echo the client's requested version when it
 *  sends one (lenient), falling back to this. */
const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'minerva', version: '0.1.2' };

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

/** Per-connection state. `clientName` is captured from the initialize handshake
 *  so propose provenance can record WHICH agent proposed (decision #2 of the
 *  substrate plan: `mcp:<client-id>`). */
export interface McpSession {
  clientName?: string;
}

interface ToolRunOptions {
  /** Provenance stamp for write tools, e.g. `mcp:claude-code`. */
  proposedBy: string;
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  run(engine: Engine, args: Record<string, unknown>, opts: ToolRunOptions): Promise<ExecResult>;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

/** The read tools, one per Engine method. Names + schemas are what an external
 *  agent sees; results are grounded JSON so the agent can attribute. */
export const MCP_TOOLS: McpTool[] = [
  {
    name: 'query_graph',
    description:
      'Run a SPARQL query against the thoughtbase knowledge graph. Standard prefixes ' +
      '(minerva, thought, dc, rdf, rdfs, xsd, csvw, prov …) are auto-injected. Returns ' +
      'bindings grounded with node IRIs.',
    inputSchema: {
      type: 'object',
      properties: { sparql: { type: 'string', description: 'A SPARQL query string.' } },
      required: ['sparql'],
    },
    run: (engine, args) => engine.query(str(args.sparql)),
  },
  {
    name: 'sql_query',
    description:
      "Run a DuckDB SQL query over the vault's CSV tables (each CSV is registered under a " +
      'name derived from its path). Returns rows.',
    inputSchema: {
      type: 'object',
      properties: { sql: { type: 'string', description: 'A DuckDB SQL query string.' } },
      required: ['sql'],
    },
    run: (engine, args) => engine.sql(str(args.sql)),
  },
  {
    name: 'search_notes',
    description: 'Full-text search over notes. Hits are grounded with the note path.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Search text.' },
        limit: { type: 'number', description: 'Max results (default 20).' },
      },
      required: ['text'],
    },
    run: (engine, args) => engine.search(str(args.text), num(args.limit)),
  },
  {
    name: 'grep_notes',
    description:
      'Exact literal or regular-expression search over the raw text of every note, like ' +
      '`grep`. Matches are grounded with note path and line number. Unlike search_notes ' +
      '(ranked, word-based) and semantic_search (meaning-based), this matches the exact ' +
      'characters — punctuation, symbols, code, casing, structure — and finds every ' +
      'occurrence, so use it for a known string, a structural pattern (unfinished tasks ' +
      '"- [ ]", "[[wiki-links]]", a "status:" property, TODO/FIXME), or to verify whether ' +
      'something literally appears. Literal substring by default; set regex:true for a ' +
      'JavaScript regular expression.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Text to find. Literal substring unless regex is true.' },
        regex: { type: 'boolean', description: 'Treat pattern as a JavaScript regular expression. Default false.' },
        case_sensitive: { type: 'boolean', description: 'Match case exactly. Default false.' },
        limit: { type: 'number', description: 'Max match lines (default 50, max 200).' },
      },
      required: ['pattern'],
    },
    run: (engine, args) =>
      engine.grep(str(args.pattern), {
        regex: args.regex === true,
        caseSensitive: args.case_sensitive === true,
        limit: num(args.limit),
      }),
  },
  {
    name: 'semantic_search',
    description:
      'Semantic (embeddings) search over notes — finds conceptually related content, not ' +
      'just keyword matches. Covers only notes the app has already embedded.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Query text.' },
        limit: { type: 'number', description: 'Max results (default 20).' },
      },
      required: ['text'],
    },
    run: (engine, args) => engine.semantic(str(args.text), num(args.limit)),
  },
  {
    name: 'read_note',
    description: "Read a note's raw markdown by its vault-relative path.",
    inputSchema: {
      type: 'object',
      properties: { relative_path: { type: 'string', description: 'Vault-relative note path.' } },
      required: ['relative_path'],
    },
    run: (engine, args) => engine.read(str(args.relative_path)),
  },
  {
    name: 'gather_context',
    description:
      'Assemble a task-relevant SLICE of the thoughtbase for a topic — the matching notes ' +
      'plus their link neighborhood (what links to them, what they link to) and full ' +
      'content — as one bundle to seed your own context. Use this before researching or ' +
      "writing, to ground yourself in what the user already knows. Prefer this over " +
      'several separate reads when you need a topic overview.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'The topic / question to gather context about.' },
        limit: { type: 'number', description: 'Max notes in the slice (default 5).' },
      },
      required: ['topic'],
    },
    run: (engine, args) => engine.context(str(args.topic), num(args.limit)),
  },
  {
    name: 'propose_note',
    description:
      'Propose a NEW note for the thoughtbase. IMPORTANT: this does NOT write to the ' +
      "vault — it files a PENDING proposal that the user reviews and approves in Minerva's " +
      'Proposals panel. The proposal is stamped with your agent identity for provenance. ' +
      'Use this to contribute findings back to the user\'s knowledge graph safely.',
    inputSchema: {
      type: 'object',
      properties: {
        relative_path: { type: 'string', description: 'Vault-relative path for the new note, e.g. notes/idea.md.' },
        content: { type: 'string', description: 'The note markdown (may include frontmatter).' },
        note: { type: 'string', description: 'Optional one-line summary shown in the review queue.' },
      },
      required: ['relative_path', 'content'],
    },
    run: (engine, args, opts) =>
      engine.proposeNote({
        relativePath: str(args.relative_path),
        content: str(args.content),
        note: str(args.note) || undefined,
        proposedBy: opts.proposedBy,
      }),
  },
];

/**
 * Handle one JSON-RPC message. Pure over the injected engine: returns the
 * response object to send, or `null` for notifications (which get no reply).
 * This is the whole protocol surface, so it's the whole thing worth testing.
 */
export async function handleMcpMessage(
  msg: JsonRpcMessage,
  engine: Engine,
  session: McpSession = {},
): Promise<JsonRpcResponse | null> {
  const id = msg.id ?? null;
  const ok = (result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result });
  const fail = (code: number, message: string): JsonRpcResponse => ({
    jsonrpc: '2.0',
    id,
    error: { code, message },
  });

  switch (msg.method) {
    case 'initialize': {
      // Capture the client's name for propose provenance.
      const clientInfo = msg.params?.clientInfo as { name?: string } | undefined;
      if (clientInfo?.name) session.clientName = clientInfo.name;
      const requested = str(msg.params?.protocolVersion);
      return ok({
        protocolVersion: requested || PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    }
    // Notifications — no response.
    case 'notifications/initialized':
    case 'initialized':
      return null;
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({
        tools: MCP_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });
    case 'tools/call': {
      const name = str(msg.params?.name);
      const tool = MCP_TOOLS.find((t) => t.name === name);
      if (!tool) return fail(-32602, `Unknown tool: ${name}`);
      const args = (msg.params?.arguments as Record<string, unknown>) ?? {};
      // Provenance for any write tool: `mcp:<client>` (decision #2 of the plan).
      const proposedBy = `mcp:${session.clientName ?? 'unknown'}`;
      const result = await tool.run(engine, args, { proposedBy });
      // Tool-level failures are reported as an MCP tool result with isError,
      // NOT a JSON-RPC error — the call itself succeeded; the tool returned a
      // problem the agent should see and can recover from.
      return result.ok
        ? ok({ content: [{ type: 'text', text: jsonStringify(result.data, true) }] })
        : ok({ content: [{ type: 'text', text: result.error }], isError: true });
    }
    default:
      // An unrecognised notification (no id) is ignored; an unrecognised request
      // gets a proper "method not found".
      if (id === null && msg.id === undefined) return null;
      return fail(-32601, `Method not found: ${msg.method ?? '(none)'}`);
  }
}

/**
 * Run the stdio MCP server over a project until the input stream closes. Reads
 * newline-delimited JSON-RPC from stdin, writes responses to stdout. Messages are
 * processed in order (a serial chain) so responses never interleave. Defaults to
 * the real process streams; tests inject their own.
 */
export async function runMcpServer(
  root: string,
  opts: EngineOptions & {
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
  } = {},
): Promise<void> {
  // Routed engine (#1524): proxy propose + semantic to a running app when one
  // is open on this thoughtbase; run direct otherwise.
  const engine = createRoutedEngine(projectContext(root), {
    embedder: opts.embedder,
    resourcesBase: opts.resourcesBase,
  });
  const session: McpSession = {};
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  const write = (obj: JsonRpcResponse) => output.write(`${jsonStringify(obj)}\n`);

  await new Promise<void>((resolve) => {
    // Serialize handling so out-of-order async completions can't interleave
    // writes; ids still let clients correlate, but ordered output is tidier.
    let chain: Promise<void> = Promise.resolve();
    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      chain = chain.then(async () => {
        let msg: JsonRpcMessage;
        try {
          msg = JSON.parse(trimmed) as JsonRpcMessage;
        } catch {
          write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
          return;
        }
        const response = await handleMcpMessage(msg, engine, session);
        if (response) write(response);
      });
    });
    rl.on('close', () => {
      void chain.then(resolve);
    });
  });
}
