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
 * Reads plus exactly one write, `propose_note` (#1147), which goes through the
 * approval gate — an external agent proposes, the human confirms. Nothing here
 * touches the vault directly.
 *
 * Every argument here is the external agent's, and that agent reads note text
 * a shared thoughtbase can plant instructions in. So the tools that take a
 * path, or a query language that can name a file, call the Engine's `agent*`
 * methods (#2452): `sql_query` → `agentSql` (registered relations only, the
 * #2442 allowlist) and `read_note` → `agentRead` (nothing under `.minerva/`).
 */
import * as readline from 'node:readline';
import { type Engine, type EngineOptions, type ExecResult } from './engine';
import { createRoutedEngine } from './routed-engine';
import { jsonStringify } from './json';
import { projectContext } from '../main/project-context-types';
import { logger } from '../shared/logger';

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

/** The exposed tools, one per Engine method. Names + schemas are what an
 *  external agent sees; results are grounded JSON so the agent can attribute.
 *  `docs/cli.md` lists them, and `tests/architecture/cli-docs-parity.test.ts`
 *  fails when a tool is added here without being documented there. */
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
      'Run one read-only DuckDB SELECT over the tables and views Minerva registered for this ' +
      'thoughtbase: each CSV file (under a name derived from its path) and each captioned markdown ' +
      'table. Query them by name; "SHOW TABLES" lists them and "DESCRIBE <table>" gives columns. ' +
      'Files cannot be read directly — read_csv / read_text / glob and quoted file paths are refused. ' +
      'Returns rows.',
    inputSchema: {
      type: 'object',
      properties: {
        sql: {
          type: 'string',
          description: 'One DuckDB SELECT / WITH / DESCRIBE / SUMMARIZE / SHOW TABLES statement over registered tables.',
        },
      },
      required: ['sql'],
    },
    // `agentSql`, never `sql` (#2452): the SQL is the external agent's, which a
    // planted note can steer, so it gets the #2442 relation allowlist. The
    // user-typed `minerva sql` CLI command is the one caller of `engine.sql`.
    run: (engine, args) => engine.agentSql(str(args.sql)),
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
    description:
      "Read a note's raw markdown by its vault-relative path. Paths inside hidden or " +
      'Minerva-internal folders (such as .minerva/) are refused.',
    inputSchema: {
      type: 'object',
      properties: { relative_path: { type: 'string', description: 'Vault-relative note path.' } },
      required: ['relative_path'],
    },
    // `agentRead`, never `read` (#2452): the path is the external agent's
    // choice, so `.minerva/` (transcripts, secrets.json) and other ignored
    // paths are refused. `minerva read` on the CLI keeps `read`.
    run: (engine, args) => engine.agentRead(str(args.relative_path)),
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

/** JSON-RPC 2.0 error codes this server emits. */
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

const log = logger('mcp-server');

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message || err.name : String(err);

/**
 * Run one tool and turn EVERY outcome into an MCP tool result (#2418).
 *
 * The MCP spec splits failures in two: a *protocol* error (unknown method,
 * malformed params, unknown tool) is a JSON-RPC `error`; a *tool execution*
 * error is a normal `result` with `isError: true`, so the agent sees it and can
 * self-correct. A tool that returns `{ ok: false }` and a tool that THROWS are
 * the same thing to the agent — both are the second kind. Before #2418 only the
 * first was handled: a throw escaped `handleMcpMessage`, rejected the stdio
 * loop's serial chain, and Node's default unhandled-rejection policy killed the
 * whole server mid-session.
 *
 * Formatting sits inside the same guard: `jsonStringify` can itself throw (a
 * cyclic value in a result), and that is equally a failure of this one call.
 */
async function runTool(
  tool: McpTool,
  engine: Engine,
  args: Record<string, unknown>,
  opts: ToolRunOptions,
): Promise<{ content: { type: 'text'; text: string }[]; isError?: true }> {
  try {
    const result = await tool.run(engine, args, opts);
    if (result.ok) return { content: [{ type: 'text', text: jsonStringify(result.data, true) }] };
    return {
      content: [{ type: 'text', text: result.error || `${tool.name} failed` }],
      isError: true,
    };
  } catch (err) {
    // The agent gets the message; the operator gets the stack, on stderr.
    log.warn(`tool ${tool.name} threw:`, err);
    return { content: [{ type: 'text', text: `${tool.name} failed: ${errorMessage(err)}` }], isError: true };
  }
}

/**
 * Handle one JSON-RPC message. Pure over the injected engine: returns the
 * response object to send, or `null` for notifications (which get no reply).
 * This is the whole protocol surface, so it's the whole thing worth testing.
 *
 * Never rejects (#2418): a tool failure becomes an `isError` result (see
 * {@link runTool}), and anything else that throws while handling a request
 * becomes a JSON-RPC internal error for that id. A throwing notification gets
 * no reply — the spec forbids replying to one — and is logged instead.
 */
export async function handleMcpMessage(
  msg: JsonRpcMessage,
  engine: Engine,
  session: McpSession = {},
): Promise<JsonRpcResponse | null> {
  const id = msg.id ?? null;
  const isNotification = msg.id === undefined;
  try {
    return await dispatch(msg, id, engine, session);
  } catch (err) {
    log.error(`handling ${msg.method ?? '(no method)'} failed:`, err);
    if (isNotification) return null;
    return { jsonrpc: '2.0', id, error: { code: INTERNAL_ERROR, message: `Internal error: ${errorMessage(err)}` } };
  }
}

async function dispatch(
  msg: JsonRpcMessage,
  id: string | number | null,
  engine: Engine,
  session: McpSession,
): Promise<JsonRpcResponse | null> {
  const ok = (result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id, result });
  const fail = (code: number, message: string): JsonRpcResponse => ({
    jsonrpc: '2.0',
    id,
    error: { code, message },
  });
  const params = isPlainObject(msg.params) ? msg.params : undefined;

  switch (msg.method) {
    case 'initialize': {
      // Capture the client's name for propose provenance.
      const clientInfo = isPlainObject(params?.clientInfo) ? params.clientInfo : undefined;
      const clientName = str(clientInfo?.name);
      if (clientName) session.clientName = clientName;
      const requested = str(params?.protocolVersion);
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
      // Malformed params and an unknown tool are PROTOCOL errors (-32602) per
      // the spec — the request could not be understood, so no tool ran.
      if (!params) return fail(INVALID_PARAMS, 'tools/call: params must be an object');
      if (typeof params.name !== 'string' || !params.name) {
        return fail(INVALID_PARAMS, 'tools/call: params.name must be a non-empty string');
      }
      const tool = MCP_TOOLS.find((t) => t.name === params.name);
      if (!tool) return fail(INVALID_PARAMS, `Unknown tool: ${params.name}`);
      if (params.arguments !== undefined && !isPlainObject(params.arguments)) {
        return fail(INVALID_PARAMS, 'tools/call: params.arguments must be an object');
      }
      const args = params.arguments ?? {};
      // Provenance for any write tool: `mcp:<client>` (decision #2 of the plan).
      const proposedBy = `mcp:${session.clientName ?? 'unknown'}`;
      // Tool-level failures — returned OR thrown — are an MCP tool result with
      // isError, NOT a JSON-RPC error: the call was well-formed; the tool hit a
      // problem the agent should see and can recover from.
      return ok(await runTool(tool, engine, args, { proposedBy }));
    }
    default:
      // An unrecognised notification (no id) is ignored; an unrecognised request
      // gets a proper "method not found".
      if (id === null && msg.id === undefined) return null;
      return fail(METHOD_NOT_FOUND, `Method not found: ${msg.method ?? '(none)'}`);
  }
}

/**
 * Handle one raw line off the wire: parse, validate the envelope, dispatch.
 * Never rejects — every way a line can go wrong is answered in-band (#2418).
 *
 * - Unparseable JSON → -32700 with `id: null` (we can't know the id).
 * - Valid JSON that isn't a request object — `null`, a number, a string, or an
 *   array (JSON-RPC batches, which MCP dropped in 2025-06-18) → -32600. Before
 *   #2418 a bare `null` line threw on `msg.id` and took the server down.
 * - A `method` that isn't a string → -32600, echoing the id if there is one.
 */
export async function handleMcpLine(
  line: string,
  engine: Engine,
  session: McpSession = {},
): Promise<JsonRpcResponse | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { jsonrpc: '2.0', id: null, error: { code: PARSE_ERROR, message: 'Parse error' } };
  }
  if (!isPlainObject(parsed)) {
    return {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: INVALID_REQUEST,
        message: Array.isArray(parsed)
          ? 'Invalid Request: JSON-RPC batches are not supported'
          : 'Invalid Request: expected a JSON-RPC object',
      },
    };
  }
  const rawId = parsed.id;
  const idOk = rawId === undefined || rawId === null || typeof rawId === 'string' || typeof rawId === 'number';
  if (!idOk || typeof parsed.method !== 'string') {
    return {
      jsonrpc: '2.0',
      id: idOk ? (rawId ?? null) : null,
      error: { code: INVALID_REQUEST, message: 'Invalid Request: method must be a string' },
    };
  }
  return handleMcpMessage(parsed, engine, session);
}

/**
 * Serialize a response for the wire. A response that can't be serialized (a
 * cyclic or otherwise unencodable value that got past `runTool`) is replaced by
 * an internal error for the same id rather than thrown — a request must always
 * get exactly one answer, or the client waits on it forever.
 */
export function encodeResponse(response: JsonRpcResponse): string {
  try {
    return jsonStringify(response);
  } catch (err) {
    log.error('could not serialize a response:', err);
    return jsonStringify({
      jsonrpc: '2.0',
      id: response.id,
      error: { code: INTERNAL_ERROR, message: `Internal error: response not serializable (${errorMessage(err)})` },
    });
  }
}

type Listener = (...args: unknown[]) => void;
interface ProcessLike {
  on(event: 'unhandledRejection', listener: Listener): unknown;
  off(event: 'unhandledRejection', listener: Listener): unknown;
}
type ConsoleLike = Pick<Console, 'log' | 'info' | 'debug' | 'error'>;

/**
 * Process-level guards for the real stdio server (#2418). Returns a disposer.
 *
 * 1. **Protocol channel hygiene.** The stdio transport requires that stdout
 *    carry nothing but MCP messages. `console.log`/`info`/`debug` write to
 *    stdout, so one informational log line anywhere on an engine path (the
 *    `logger` seam's `.info` is `console.info`) would hand the client a
 *    non-JSON line mid-session. They are pointed at stderr — which MCP clients
 *    capture as the server's log — for the server's lifetime.
 *
 * 2. **`unhandledRejection` backstop: log, don't exit.** Every in-band path is
 *    already caught per message (`handleMcpLine` never rejects), so anything
 *    that reaches this handler is a *detached* promise — a fire-and-forget
 *    inside an indexer, say — whose failure has no caller left to report to.
 *    Node's default for that is to crash, which ends the agent's whole session
 *    over a failure no request is waiting on. A long-lived stdio server is
 *    better off logging it to stderr and continuing. `uncaughtException` is
 *    deliberately NOT trapped: a synchronous throw that unwound past every
 *    frame leaves state unknown, and Node's own guidance is that resuming after
 *    one is unsafe — dying there, loudly, is correct.
 *
 * Only installed when `output` is the real `process.stdout`; tests driving the
 * server over in-memory streams, or the guard itself via fakes, opt in
 * explicitly.
 */
export function installStdioGuards(
  proc: ProcessLike = process,
  cons: ConsoleLike = console,
): () => void {
  const onRejection: Listener = (reason) => {
    log.error('unhandled rejection (server kept running):', reason);
  };
  proc.on('unhandledRejection', onRejection);

  const saved = { log: cons.log, info: cons.info, debug: cons.debug };
  const toStderr = (...args: unknown[]) => cons.error(...args);
  cons.log = toStderr;
  cons.info = toStderr;
  cons.debug = toStderr;

  return () => {
    proc.off('unhandledRejection', onRejection);
    cons.log = saved.log;
    cons.info = saved.info;
    cons.debug = saved.debug;
  };
}

/**
 * Run the stdio MCP server over a project until the input stream closes. Reads
 * newline-delimited JSON-RPC from stdin, writes responses to stdout. Messages are
 * processed in order (a serial chain) so responses never interleave. Defaults to
 * the real process streams; tests inject their own.
 *
 * One bad message cannot end the session (#2418): `handleMcpLine` answers every
 * failure in-band, and each chain step also catches, because a rejected link
 * would silently skip every later message (`.then` doesn't run on a rejected
 * promise) and leave `close` never resolving.
 */
export async function runMcpServer(
  root: string,
  opts: EngineOptions & {
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
    /** Override for tests; defaults to "output is the real process.stdout". */
    processGuards?: boolean;
    /** Test seam: an engine to serve instead of the routed one over `root`. */
    engine?: Engine;
  } = {},
): Promise<void> {
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;
  const disposeGuards = (opts.processGuards ?? output === process.stdout) ? installStdioGuards() : null;

  try {
    // Routed engine (#1524): proxy propose + semantic to a running app when one
    // is open on this thoughtbase; run direct otherwise.
    const engine =
      opts.engine ??
      createRoutedEngine(projectContext(root), {
        embedder: opts.embedder,
        resourcesBase: opts.resourcesBase,
      });
    const session: McpSession = {};
    const rl = readline.createInterface({ input, crlfDelay: Infinity });

    // The write side: a client that disconnects mid-session surfaces as EPIPE
    // on `output`. An unlistened 'error' event throws, so listen — there is
    // nobody left to answer, so stop reading and let the server wind down.
    let outputClosed = false;
    output.on('error', (err: unknown) => {
      if (outputClosed) return;
      outputClosed = true;
      log.warn('output stream failed; shutting down:', err);
      rl.close();
    });
    // Input errors reach readline's interface (Node >= 16); same reasoning.
    rl.on('error', (err: unknown) => {
      log.warn('input stream failed; shutting down:', err);
      rl.close();
    });

    const write = (obj: JsonRpcResponse) => {
      if (outputClosed) return;
      output.write(`${encodeResponse(obj)}\n`);
    };

    await new Promise<void>((resolve) => {
      // Serialize handling so out-of-order async completions can't interleave
      // writes; ids still let clients correlate, but ordered output is tidier.
      let chain: Promise<void> = Promise.resolve();
      rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        chain = chain.then(async () => {
          try {
            const response = await handleMcpLine(trimmed, engine, session);
            if (response) write(response);
          } catch (err) {
            // Unreachable by construction; kept so the chain can never reject.
            log.error('message handling failed:', err);
          }
        });
      });
      rl.on('close', () => {
        void chain.then(resolve);
      });
    });
  } finally {
    disposeGuards?.();
  }
}
