/**
 * Public facade (#2029) — the one thing a later issue imports.
 * `connectMcpServer` picks a transport based on `descriptor.kind` and, for
 * HTTP, the outcome of era detection, then returns a thin `McpClient` view
 * over it. Also owns the live-client registry for the app-quit hook.
 */
import { logger } from '../../shared/logger';
import { McpAuthRequiredError, McpConnectionError } from './errors';
import { decideEra, getEraProbeTimeoutMs } from './era';
import { modernHeaders, modernMeta, postJsonRpc, timeoutSignal } from './http/http-common';
import { LegacyHttpTransport } from './http/legacy-http-transport';
import { ModernHttpTransport } from './http/modern-http-transport';
import { defaultInputRequiredHandler } from './mrtr';
import { StdioTransport } from './stdio-transport';
import type {
  InputRequiredHandler,
  McpEra,
  McpServerDescriptor,
  McpToolCallResult,
  McpToolDescriptor,
  McpTransport,
} from './types';

export interface McpClient {
  readonly era: McpEra;
  listTools(signal?: AbortSignal): Promise<McpToolDescriptor[]>;
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpToolCallResult>;
  close(): Promise<void>;
}

export interface ConnectMcpServerOptions {
  signal?: AbortSignal;
  /** Resolves a modern-era `input_required` result. Defaults to
   *  `defaultInputRequiredHandler` (honest no-op answers, throws for
   *  `sampling/createMessage`) — see `mrtr.ts`. */
  inputRequiredHandler?: InputRequiredHandler;
}

const liveTransports = new Set<McpTransport>();

/** Connect to a server, speaking whichever transport/era it needs. Throws
 *  on failure — see `errors.ts` for the specific subtypes a caller can
 *  branch on (auth-required, protocol violation, generic connection failure). */
export async function connectMcpServer(
  descriptor: McpServerDescriptor,
  opts: ConnectMcpServerOptions = {},
): Promise<McpClient> {
  const transport = await buildTransport(descriptor, opts);
  liveTransports.add(transport);
  return {
    get era() {
      return transport.era;
    },
    listTools: (signal) => transport.listTools(signal),
    callTool: (name, args, signal) => transport.callTool(name, args, signal),
    close: async () => {
      liveTransports.delete(transport);
      await transport.close();
    },
  };
}

async function buildTransport(descriptor: McpServerDescriptor, opts: ConnectMcpServerOptions): Promise<McpTransport> {
  const inputRequiredHandler = opts.inputRequiredHandler ?? defaultInputRequiredHandler;

  if (descriptor.kind === 'stdio') {
    const transport = new StdioTransport(descriptor, inputRequiredHandler);
    await transport.connect(opts.signal);
    return transport;
  }

  const { era, modernProbeError } = await probeHttpEra(descriptor, opts.signal);
  if (era === 'modern') {
    const transport = new ModernHttpTransport(descriptor, inputRequiredHandler);
    await transport.connect(opts.signal);
    return transport;
  }

  const transport = new LegacyHttpTransport(descriptor);
  try {
    await transport.connect(opts.signal);
  } catch (legacyError) {
    if (legacyError instanceof McpAuthRequiredError) throw legacyError;
    throw new McpConnectionError('era detection failed — neither a modern nor a legacy handshake succeeded', {
      modernProbeError,
      legacyError,
    });
  }
  return transport;
}

/** Probe with `server/discover`; a network/timeout failure is treated as
 *  "try legacy next" rather than an immediate error — only a 401/403
 *  propagates immediately (auth is a distinct failure mode a later issue
 *  needs to catch specifically), and only a legacy attempt that ALSO fails
 *  turns this probe's failure into part of a thrown error. */
async function probeHttpEra(
  descriptor: Extract<McpServerDescriptor, { kind: 'http' }>,
  signal?: AbortSignal,
): Promise<{ era: McpEra; modernProbeError?: unknown }> {
  const id = 'mcp-client-discover-probe';
  try {
    const { response } = await postJsonRpc(
      descriptor.url,
      { jsonrpc: '2.0', id, method: 'server/discover', params: { _meta: modernMeta() } },
      { ...modernHeaders('server/discover', {}), ...(descriptor.headers ?? {}) },
      { signal: timeoutSignal(getEraProbeTimeoutMs(), signal), expectedId: id },
    );
    return { era: decideEra({ response }) };
  } catch (err) {
    if (err instanceof McpAuthRequiredError) throw err;
    logger('mcp-client').debug('server/discover probe failed, trying a legacy handshake next:', err);
    return { era: 'legacy', modernProbeError: err };
  }
}

/** App-quit hook target — tears down every live connection concurrently. */
export async function shutdownAllMcpClients(): Promise<void> {
  const transports = [...liveTransports];
  liveTransports.clear();
  await Promise.allSettled(transports.map((t) => t.close()));
}
