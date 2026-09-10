/**
 * stdio MCP transport (#2029) — spawn the server as a subprocess,
 * newline-delimited JSON-RPC over stdin/stdout. Process lifecycle mirrors
 * `src/main/compute/python-kernel.ts`: `readline` per stream, a non-JSON
 * line is logged and dropped rather than crashing the transport, stderr is
 * forwarded to the logger and never treated as an error signal (spec:
 * clients SHOULD NOT assume stderr indicates error conditions), and
 * `close()` escalates SIGTERM→SIGKILL with a grace period.
 *
 * No sandboxing/network guard here (unlike the Python kernel) — an MCP
 * stdio server is *supposed* to reach its own credentialed services; the
 * spec's auth model for stdio is "credentials come from the server's own
 * environment," not from this client.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';
import { logger } from '../../shared/logger';
import { McpConnectionError, McpProtocolError } from './errors';
import {
  PendingRequests,
  RequestIdSequence,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
  type JsonRpcResponse,
  type JsonRpcSuccess,
} from './json-rpc';
import { decideEra, ERA_PROBE_TIMEOUT_MS, LEGACY_PROTOCOL_VERSION, MCP_ERROR_CODES, MODERN_PROTOCOL_VERSION } from './era';
import { defaultInputRequiredHandler, resolveMrtr, type ModernResult } from './mrtr';
import {
  CLIENT_INFO,
  type InputRequiredHandler,
  type McpContentBlock,
  type McpEra,
  type McpServerDescriptor,
  type McpToolCallResult,
  type McpToolDescriptor,
  type McpTransport,
} from './types';

type StdioDescriptor = Extract<McpServerDescriptor, { kind: 'stdio' }>;

const GRACEFUL_CLOSE_TIMEOUT_MS = 2000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

function modernMeta(): Record<string, unknown> {
  return {
    'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
    'io.modelcontextprotocol/clientInfo': CLIENT_INFO,
    'io.modelcontextprotocol/clientCapabilities': {},
  };
}

export class StdioTransport implements McpTransport {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new PendingRequests();
  private readonly ids = new RequestIdSequence();
  private resolvedEra: McpEra | null = null;
  private dead = false;

  constructor(
    private readonly descriptor: StdioDescriptor,
    private readonly inputRequiredHandler: InputRequiredHandler = defaultInputRequiredHandler,
  ) {}

  get era(): McpEra {
    if (!this.resolvedEra) throw new McpConnectionError('era accessed before connect() resolved');
    return this.resolvedEra;
  }

  async connect(signal?: AbortSignal): Promise<void> {
    if (this.proc) throw new McpConnectionError('already connected');

    const proc = spawn(this.descriptor.command, this.descriptor.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.descriptor.env },
      cwd: this.descriptor.cwd,
    });
    this.proc = proc;

    const rl = readline.createInterface({ input: proc.stdout });
    rl.on('line', (line) => this.handleLine(line));

    const errRl = readline.createInterface({ input: proc.stderr });
    errRl.on('line', (line) => {
      if (line.trim()) logger('mcp-client').debug('stdio server stderr:', line);
    });

    proc.on('exit', (code, signalName) => {
      this.dead = true;
      const reason = signalName ? `signal ${signalName}` : `code ${code}`;
      this.pending.rejectAll(new McpConnectionError(`mcp server process exited (${reason})`));
    });

    const spawnFailure = new Promise<never>((_resolve, reject) => {
      proc.once('error', (err) => {
        this.dead = true;
        reject(new McpConnectionError(`mcp server failed to spawn: ${err.message}`));
      });
    });

    await Promise.race([this.probeEra(signal), spawnFailure]);
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: unknown;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      logger('mcp-client').warn('non-JSON stdio line:', trimmed);
      return;
    }
    if (isJsonRpcResponse(msg)) {
      if (msg.id === null) {
        logger('mcp-client').warn('response with null id, cannot correlate:', trimmed);
        return;
      }
      this.pending.resolve(msg.id, msg);
      return;
    }
    if (isJsonRpcRequest(msg)) {
      // A server-initiated request over stdio (legacy era's
      // sampling/createMessage, roots/list, etc.) — answer honestly rather
      // than leave the server hanging. Real dispatch into domain UI is a
      // later issue; for now this matches the legacy HTTP transport's GET
      // stream handling of the same situation.
      const req = msg;
      if (req.method === 'roots/list') {
        this.writeRaw({ jsonrpc: '2.0', id: req.id, result: { roots: [] } });
      } else {
        this.writeRaw({
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32601, message: `Client does not support ${req.method} (mcp-client v1)` },
        });
      }
      return;
    }
    if (isJsonRpcNotification(msg)) {
      logger('mcp-client').debug('unhandled server-initiated notification:', msg.method);
      return;
    }
    logger('mcp-client').warn('unrecognized stdio message shape:', trimmed);
  }

  private writeRaw(payload: Record<string, unknown>): void {
    if (!this.proc || this.dead) throw new McpConnectionError('mcp transport is not connected');
    this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private async probeEra(signal?: AbortSignal): Promise<void> {
    const discoverId = this.ids.nextId();
    const discoverPromise = this.pending.register(discoverId, ERA_PROBE_TIMEOUT_MS);
    this.writeRaw({ jsonrpc: '2.0', id: discoverId, method: 'server/discover', params: { _meta: modernMeta() } });

    let response: JsonRpcResponse | null;
    try {
      response = await discoverPromise;
    } catch {
      response = null; // timeout — decideEra treats this as legacy
    }
    void signal; // stdio connect() has no separate cancellation path yet — accepted for interface symmetry

    const era = decideEra({ response });
    if (era === 'modern') {
      if (response && 'error' in response && response.error.code === MCP_ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION) {
        const supported = (response.error.data as { supported?: string[] } | undefined)?.supported ?? [];
        if (!supported.includes(MODERN_PROTOCOL_VERSION)) {
          throw new McpConnectionError(
            `no mutually supported protocol version (server supports: ${supported.join(', ') || 'none reported'})`,
          );
        }
      }
      this.resolvedEra = 'modern';
      return;
    }

    const initId = this.ids.nextId();
    const initPromise = this.pending.register(initId, ERA_PROBE_TIMEOUT_MS);
    this.writeRaw({
      jsonrpc: '2.0',
      id: initId,
      method: 'initialize',
      params: { protocolVersion: LEGACY_PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
    });
    const initResponse = await initPromise;
    if ('error' in initResponse) {
      throw new McpConnectionError(`legacy initialize failed: ${initResponse.error.message}`);
    }
    this.writeRaw({ jsonrpc: '2.0', method: 'notifications/initialized' });
    this.resolvedEra = 'legacy';
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<JsonRpcSuccess> {
    if (this.dead) throw new McpConnectionError('mcp transport is not connected');
    const id = this.ids.nextId();
    const fullParams = this.resolvedEra === 'modern' ? { ...params, _meta: modernMeta() } : params;
    const responsePromise = this.pending.register(id, timeoutMs);
    this.writeRaw({ jsonrpc: '2.0', id, method, params: fullParams });

    const onAbort = () => {
      this.pending.reject(id, new McpConnectionError(`request "${method}" aborted`));
      try {
        this.writeRaw({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: id } });
      } catch {
        // Best-effort — the process may already be gone.
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const response = await responsePromise;
      if ('error' in response) throw new McpProtocolError(response.error.message, response.error.code);
      return response;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async listTools(signal?: AbortSignal): Promise<McpToolDescriptor[]> {
    const response = await this.request('tools/list', {}, signal);
    const tools = response.result.tools;
    return Array.isArray(tools) ? (tools as McpToolDescriptor[]) : [];
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpToolCallResult> {
    const doCall = async (extra?: Record<string, unknown>): Promise<ModernResult> => {
      const response = await this.request('tools/call', { name, arguments: args, ...extra }, signal);
      return response.result;
    };
    let result = await doCall();
    if (this.resolvedEra === 'modern') {
      result = await resolveMrtr(
        result,
        (inputResponses, requestState) =>
          doCall({ inputResponses, ...(requestState !== undefined ? { requestState } : {}) }),
        this.inputRequiredHandler,
      );
    }
    const content = Array.isArray(result.content) ? (result.content as McpContentBlock[]) : [];
    return { content, isError: result.isError === true };
  }

  async close(): Promise<void> {
    this.dead = true;
    const proc = this.proc;
    if (!proc || proc.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      proc.stdin.end();
      proc.kill('SIGTERM');
      const timer = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          // already gone
        }
        resolve();
      }, GRACEFUL_CLOSE_TIMEOUT_MS);
      proc.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
