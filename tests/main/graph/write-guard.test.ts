/**
 * LLM write guard (#671) — now tested in isolation against the extracted
 * write-guard module, including the actual guard *behaviour* (does it warn?),
 * which the previous version only gestured at (QA #657 / Q-C1).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

describe('checkLLMWriteGuard behaviour (fatal under test, #944)', () => {
  // These run under vitest, where the guard is FATAL — it throws rather than
  // warns, so an accidental approval-engine bypass fails CI. (In dev/prod it
  // stays a non-fatal console.warn; that branch isn't exercised here.)

  it('stays silent outside LLM context', () => {
    expect(() => checkLLMWriteGuard('indexNote')).not.toThrow();
  });

  it('THROWS when a graph write happens in LLM context outside the approval engine', () => {
    enterLLMContext();
    expect(() => checkLLMWriteGuard('indexNote')).toThrow(/\[trust-guard\].*indexNote.*proposeWrite/s);
  });

  it('stays silent in LLM context when the write is inside a trusted (approval-engine) context', () => {
    enterLLMContext();
    enterTrustedContext();
    expect(() => checkLLMWriteGuard('indexSource')).not.toThrow();
  });

  it('re-arms once the trusted context is exited but LLM context remains', () => {
    enterLLMContext();
    enterTrustedContext();
    expect(() => checkLLMWriteGuard('indexSource')).not.toThrow();
    exitTrustedContext();
    expect(() => checkLLMWriteGuard('indexSource')).toThrow(/\[trust-guard\]/);
  });
});
