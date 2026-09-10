/**
 * Era detection (#2029) — pure decision function. Grounded in the 2026-07-28
 * spec's own backward-compatibility algorithm: only the three MCP-specific
 * reserved error codes count as "definitely modern"; everything else,
 * including a timeout (no response) and the codes a legacy server commonly
 * emits for an unrecognized pre-initialize method, resolves to legacy.
 */
import { describe, it, expect } from 'vitest';
import { decideEra, MCP_ERROR_CODES } from '../../../src/main/mcp-client/era';
import type { JsonRpcResponse } from '../../../src/main/mcp-client/json-rpc';

function success(): JsonRpcResponse {
  return { jsonrpc: '2.0', id: 1, result: { supportedVersions: ['2026-07-28'] } };
}
function failure(code: number): JsonRpcResponse {
  return { jsonrpc: '2.0', id: 1, error: { code, message: 'x' } };
}

describe('decideEra (#2029)', () => {
  it('a well-formed DiscoverResult means modern', () => {
    expect(decideEra({ response: success() })).toBe('modern');
  });

  it.each([
    ['HeaderMismatch', MCP_ERROR_CODES.HEADER_MISMATCH],
    ['MissingClientCapability', MCP_ERROR_CODES.MISSING_CLIENT_CAPABILITY],
    ['UnsupportedProtocolVersion', MCP_ERROR_CODES.UNSUPPORTED_PROTOCOL_VERSION],
  ])('%s (%d) means modern', (_name, code) => {
    expect(decideEra({ response: failure(code) })).toBe('modern');
  });

  it.each([
    ['Method not found', -32601],
    ['Invalid params', -32602],
    ['Parse error', -32700],
    ['some implementation-defined code', -1],
  ])('%s (%d) means legacy — not a recognized modern error', (_name, code) => {
    expect(decideEra({ response: failure(code) })).toBe('legacy');
  });

  it('no response (timeout / network failure) means legacy', () => {
    expect(decideEra({ response: null })).toBe('legacy');
  });
});
