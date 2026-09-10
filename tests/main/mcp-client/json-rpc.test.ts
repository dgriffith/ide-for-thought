/**
 * Shared JSON-RPC envelope guards + request/response correlation (#2029).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
  PendingRequests,
  RequestIdSequence,
} from '../../../src/main/mcp-client/json-rpc';

describe('type guards', () => {
  it('isJsonRpcResponse accepts a success', () => {
    expect(isJsonRpcResponse({ jsonrpc: '2.0', id: 1, result: {} })).toBe(true);
  });
  it('isJsonRpcResponse accepts a failure', () => {
    expect(isJsonRpcResponse({ jsonrpc: '2.0', id: 1, error: { code: -1, message: 'x' } })).toBe(true);
  });
  it('isJsonRpcResponse rejects a request (has method)', () => {
    expect(isJsonRpcResponse({ jsonrpc: '2.0', id: 1, method: 'x' })).toBe(false);
  });
  it('isJsonRpcResponse rejects malformed input', () => {
    expect(isJsonRpcResponse(null)).toBe(false);
    expect(isJsonRpcResponse('a string')).toBe(false);
    expect(isJsonRpcResponse({ jsonrpc: '1.0', id: 1, result: {} })).toBe(false);
    expect(isJsonRpcResponse({ jsonrpc: '2.0', result: {} })).toBe(false); // no id
  });

  it('isJsonRpcNotification accepts a method with no id', () => {
    expect(isJsonRpcNotification({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBe(true);
  });
  it('isJsonRpcNotification rejects a request (has id)', () => {
    expect(isJsonRpcNotification({ jsonrpc: '2.0', id: 1, method: 'x' })).toBe(false);
  });

  it('isJsonRpcRequest accepts method + id together', () => {
    expect(isJsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'roots/list' })).toBe(true);
  });
  it('isJsonRpcRequest rejects a notification (no id)', () => {
    expect(isJsonRpcRequest({ jsonrpc: '2.0', method: 'x' })).toBe(false);
  });
});

describe('RequestIdSequence', () => {
  it('produces monotonically increasing ids starting from 1', () => {
    const ids = new RequestIdSequence();
    expect(ids.nextId()).toBe(1);
    expect(ids.nextId()).toBe(2);
    expect(ids.nextId()).toBe(3);
  });
});

describe('PendingRequests', () => {
  it('resolve() delivers the response to the matching register()', async () => {
    const pending = new PendingRequests();
    const promise = pending.register(1);
    pending.resolve(1, { jsonrpc: '2.0', id: 1, result: { ok: true } });
    await expect(promise).resolves.toEqual({ jsonrpc: '2.0', id: 1, result: { ok: true } });
  });

  it('reject() rejects the matching register()', async () => {
    const pending = new PendingRequests();
    const promise = pending.register(1);
    pending.reject(1, new Error('boom'));
    await expect(promise).rejects.toThrow('boom');
  });

  it('resolve()/reject() on an unknown id is a no-op', () => {
    const pending = new PendingRequests();
    expect(() => pending.resolve(999, { jsonrpc: '2.0', id: 999, result: {} })).not.toThrow();
    expect(() => pending.reject(999, new Error('x'))).not.toThrow();
  });

  it('rejectAll() rejects every still-pending request', async () => {
    const pending = new PendingRequests();
    const a = pending.register(1);
    const b = pending.register(2);
    pending.rejectAll(new Error('connection dropped'));
    await expect(a).rejects.toThrow('connection dropped');
    await expect(b).rejects.toThrow('connection dropped');
  });

  it('rejectAll() does not affect a request registered afterward', async () => {
    const pending = new PendingRequests();
    pending.rejectAll(new Error('dropped'));
    const promise = pending.register(1);
    pending.resolve(1, { jsonrpc: '2.0', id: 1, result: {} });
    await expect(promise).resolves.toEqual({ jsonrpc: '2.0', id: 1, result: {} });
  });

  it('times out and rejects when no response arrives within timeoutMs', async () => {
    vi.useFakeTimers();
    try {
      const pending = new PendingRequests();
      const promise = pending.register(1, 1000);
      const assertion = expect(promise).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('a late resolve() after timeout is a harmless no-op', async () => {
    vi.useFakeTimers();
    try {
      const pending = new PendingRequests();
      const promise = pending.register(1, 1000);
      const assertion = expect(promise).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
      expect(() => pending.resolve(1, { jsonrpc: '2.0', id: 1, result: {} })).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});
