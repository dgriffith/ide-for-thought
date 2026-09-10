/**
 * Protocol era detection (#2029) — grounded in the 2026-07-28 spec's own
 * stated backward-compatibility algorithm
 * (`basic/versioning#backward-compatibility-with-initialization-based-versions`):
 * probe with `server/discover` (a real, mandatory-for-modern-servers,
 * transport-agnostic method) and fall back to the legacy `initialize`
 * handshake on anything that isn't a recognized modern error.
 *
 * The fallback must NOT be keyed to one specific error code — legacy
 * servers respond to an unknown pre-initialize method with
 * implementation-defined errors (commonly -32601/-32602) or not at all, so
 * only the three MCP-specific reserved codes below count as "definitely
 * modern". Everything else, including a timeout, resolves to legacy.
 */
import type { JsonRpcResponse } from './json-rpc';
import type { McpEra } from './types';

export const MCP_ERROR_CODES = {
  HEADER_MISMATCH: -32020,
  MISSING_CLIENT_CAPABILITY: -32021,
  UNSUPPORTED_PROTOCOL_VERSION: -32022,
} as const;

/** Matches the real legacy reference server verified against this client
 *  (`@modelcontextprotocol/server-everything`). */
export const LEGACY_PROTOCOL_VERSION = '2025-06-18';
export const MODERN_PROTOCOL_VERSION = '2026-07-28';

/** 5s probe timeout — generous enough for a cold subprocess spawn or a
 *  slow-starting HTTP server, short enough not to stall connect() for long
 *  against a genuinely dead server. */
export const ERA_PROBE_TIMEOUT_MS = 5000;

export interface EraProbeSignal {
  /** `null` = no response — timeout, transport error, or connection refused. */
  response: JsonRpcResponse | null;
}

const MODERN_ERROR_CODES: number[] = Object.values(MCP_ERROR_CODES);

/** Pure — no I/O, so this is trivially unit-testable against every signal
 *  shape a real probe can produce. */
export function decideEra(signal: EraProbeSignal): McpEra {
  if (!signal.response) return 'legacy';
  if ('result' in signal.response) return 'modern';
  return MODERN_ERROR_CODES.includes(signal.response.error.code) ? 'modern' : 'legacy';
}
