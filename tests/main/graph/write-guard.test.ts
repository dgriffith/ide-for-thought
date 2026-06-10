/**
 * LLM write guard (#671) — now tested in isolation against the extracted
 * write-guard module, including the actual guard *behaviour* (does it warn?),
 * which the previous version only gestured at (QA #657 / Q-C1).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  enterLLMContext,
  exitLLMContext,
  isInLLMContext,
  enterTrustedContext,
  exitTrustedContext,
  isInTrustedContext,
  checkLLMWriteGuard,
  __resetWriteGuardForTests,
} from '../../../src/main/graph/write-guard';

beforeEach(() => __resetWriteGuardForTests());
afterEach(() => __resetWriteGuardForTests());

describe('LLM context counter', () => {
  it('starts outside LLM context', () => {
    expect(isInLLMContext()).toBe(false);
  });

  it('enters and exits LLM context', () => {
    enterLLMContext();
    expect(isInLLMContext()).toBe(true);
    exitLLMContext();
    expect(isInLLMContext()).toBe(false);
  });

  it('is nest-safe — inner exit keeps the outer context open', () => {
    enterLLMContext();
    enterLLMContext();
    exitLLMContext();
    expect(isInLLMContext()).toBe(true);
    exitLLMContext();
    expect(isInLLMContext()).toBe(false);
  });

  it('does not go negative on extra exits', () => {
    exitLLMContext();
    exitLLMContext();
    expect(isInLLMContext()).toBe(false);
    enterLLMContext();
    expect(isInLLMContext()).toBe(true);
  });
});

describe('trusted context counter', () => {
  it('tracks enter/exit and is nest-safe', () => {
    expect(isInTrustedContext()).toBe(false);
    enterTrustedContext();
    enterTrustedContext();
    expect(isInTrustedContext()).toBe(true);
    exitTrustedContext();
    expect(isInTrustedContext()).toBe(true);
    exitTrustedContext();
    expect(isInTrustedContext()).toBe(false);
  });
});

describe('checkLLMWriteGuard behaviour', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => warnSpy.mockRestore());

  it('stays silent outside LLM context', () => {
    checkLLMWriteGuard('indexNote');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('WARNS when a graph write happens in LLM context outside the approval engine', () => {
    enterLLMContext();
    checkLLMWriteGuard('indexNote');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = String(warnSpy.mock.calls[0][0]);
    expect(msg).toContain('[trust-guard]');
    expect(msg).toContain('indexNote');
    expect(msg).toContain('proposeWrite');
  });

  it('stays silent in LLM context when the write is inside a trusted (approval-engine) context', () => {
    enterLLMContext();
    enterTrustedContext();
    checkLLMWriteGuard('indexSource');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('re-warns once the trusted context is exited but LLM context remains', () => {
    enterLLMContext();
    enterTrustedContext();
    checkLLMWriteGuard('indexSource');
    expect(warnSpy).not.toHaveBeenCalled();
    exitTrustedContext();
    checkLLMWriteGuard('indexSource');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
