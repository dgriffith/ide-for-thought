/**
 * Shared JSON-RPC 2.0 envelope types + request/response correlation (#2029).
 *
 * Genuinely shared between transports: envelope types, type guards, id
 * generation. `PendingRequests` (async correlation by id) is used by
 * `stdio-transport.ts`, where responses arrive later on a shared stdout
 * channel — the HTTP transports get 1:1 correlation for free from `fetch`
 * itself and only need `RequestIdSequence` + the types/guards below.
 */
import { McpConnectionError } from './errors';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: string | number;
  result: Record<string, unknown>;
}

export interface JsonRpcFailure {
  jsonrpc: '2.0';
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function isJsonRpcResponse(v: unknown): v is JsonRpcResponse {
  if (!isRecord(v) || v.jsonrpc !== '2.0' || !('id' in v)) return false;
  return 'result' in v || 'error' in v;
}

/** A notification has a method and no id — never gets a reply. */
export function isJsonRpcNotification(v: unknown): v is JsonRpcNotification {
  return isRecord(v) && v.jsonrpc === '2.0' && typeof v.method === 'string' && !('id' in v);
}

/** A server-initiated request has both a method and an id. */
export function isJsonRpcRequest(v: unknown): v is JsonRpcRequest {
  return isRecord(v) && v.jsonrpc === '2.0' && typeof v.method === 'string' && 'id' in v;
}

/** Monotonically increasing request ids, one sequence per transport instance. */
export class RequestIdSequence {
  private next = 1;
  nextId(): number {
    return this.next++;
  }
}

interface PendingEntry {
  resolve: (response: JsonRpcResponse) => void;
  reject: (err: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
}

/** Correlates async responses to the request that asked for them, by id. */
export class PendingRequests {
  private readonly entries = new Map<string | number, PendingEntry>();

  /** Register a request awaiting a response. Rejects on `timeoutMs` if given. */
  register(id: string | number, timeoutMs?: number): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      const entry: PendingEntry = { resolve, reject };
      if (timeoutMs !== undefined) {
        entry.timer = setTimeout(() => {
          this.entries.delete(id);
          reject(new McpConnectionError(`request ${id} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }
      this.entries.set(id, entry);
    });
  }

  resolve(id: string | number, response: JsonRpcResponse): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.entries.delete(id);
    entry.resolve(response);
  }

  reject(id: string | number, err: Error): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.entries.delete(id);
    entry.reject(err);
  }

  /** Reject every still-pending request — used on process exit / connection drop. */
  rejectAll(err: Error): void {
    for (const entry of this.entries.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.entries.clear();
  }
}
