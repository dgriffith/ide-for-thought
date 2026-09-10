/**
 * MRTR loop + default input-required handler (#2029) — pure, transport-agnostic.
 */
import { describe, it, expect, vi } from 'vitest';
import { defaultInputRequiredHandler, resolveMrtr, MAX_MRTR_ROUNDS } from '../../../src/main/mcp-client/mrtr';
import { McpInputRequiredUnhandledError, McpProtocolError } from '../../../src/main/mcp-client/errors';

describe('defaultInputRequiredHandler', () => {
  it('answers roots/list honestly with no roots', async () => {
    const out = await defaultInputRequiredHandler({ a: { method: 'roots/list', params: {} } });
    expect(out).toEqual({ a: { roots: [] } });
  });
  it('answers elicitation/create with a spec-legal decline', async () => {
    const out = await defaultInputRequiredHandler({ a: { method: 'elicitation/create', params: {} } });
    expect(out).toEqual({ a: { action: 'decline' } });
  });
  it('refuses to fabricate a sampling/createMessage response', async () => {
    await expect(defaultInputRequiredHandler({ a: { method: 'sampling/createMessage', params: {} } }))
      .rejects.toThrow(McpInputRequiredUnhandledError);
  });
});

describe('resolveMrtr', () => {
  it('returns a complete result unchanged, without calling reissue', async () => {
    const reissue = vi.fn();
    const result = await resolveMrtr({ resultType: 'complete', content: [] }, reissue);
    expect(result).toEqual({ resultType: 'complete', content: [] });
    expect(reissue).not.toHaveBeenCalled();
  });

  it('treats an absent resultType as complete', async () => {
    const reissue = vi.fn();
    const result = await resolveMrtr({ content: [] }, reissue);
    expect(result).toEqual({ content: [] });
    expect(reissue).not.toHaveBeenCalled();
  });

  it('re-issues with inputResponses + requestState, then returns the completed result', async () => {
    const reissue = vi.fn().mockResolvedValue({ resultType: 'complete', content: [{ type: 'text', text: 'done' }] });
    const result = await resolveMrtr(
      { resultType: 'input_required', inputRequests: { a: { method: 'roots/list', params: {} } }, requestState: 'opaque' },
      reissue,
    );
    expect(reissue).toHaveBeenCalledWith({ a: { roots: [] } }, 'opaque');
    expect(result).toEqual({ resultType: 'complete', content: [{ type: 'text', text: 'done' }] });
  });

  it('loops through multiple input_required rounds', async () => {
    const reissue = vi.fn()
      .mockResolvedValueOnce({ resultType: 'input_required', inputRequests: { a: { method: 'roots/list', params: {} } } })
      .mockResolvedValueOnce({ resultType: 'complete', content: [] });
    const result = await resolveMrtr(
      { resultType: 'input_required', inputRequests: { a: { method: 'roots/list', params: {} } } },
      reissue,
    );
    expect(reissue).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ resultType: 'complete', content: [] });
  });

  it('throws when the loop exceeds MAX_MRTR_ROUNDS without completing', async () => {
    const reissue = vi.fn().mockResolvedValue({
      resultType: 'input_required', inputRequests: { a: { method: 'roots/list', params: {} } },
    });
    await expect(
      resolveMrtr({ resultType: 'input_required', inputRequests: { a: { method: 'roots/list', params: {} } } }, reissue),
    ).rejects.toThrow(McpProtocolError);
    expect(reissue).toHaveBeenCalledTimes(MAX_MRTR_ROUNDS);
  });

  it('uses a custom handler when given, instead of the default', async () => {
    const handler = vi.fn().mockResolvedValue({ a: { custom: true } });
    const reissue = vi.fn().mockResolvedValue({ resultType: 'complete', content: [] });
    await resolveMrtr(
      { resultType: 'input_required', inputRequests: { a: { method: 'sampling/createMessage', params: {} } } },
      reissue,
      handler,
    );
    expect(handler).toHaveBeenCalled();
    expect(reissue).toHaveBeenCalledWith({ a: { custom: true } }, undefined);
  });
});
