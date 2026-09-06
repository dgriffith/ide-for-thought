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
  withLLMContext,
  withTrustedContext,
  __resetWriteGuardForTests,
} from '../../../src/main/graph/write-guard';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

describe('async-context isolation between concurrent operations (#2053)', () => {
  // The bug #2053 fixes: a plain module-global counter is shared by EVERY
  // concurrent call path. Two operations in flight at once — an LLM
  // operation and a concurrent approval-engine apply, say — would share the
  // same counter, so one path's context window could mask or falsely trip
  // the guard for a completely unrelated path. These would FAIL against the
  // pre-#2053 module-global implementation; they pass now because
  // AsyncLocalStorage gives each root-level async call tree its own depth.

  it('does not leak isInLLMContext across a concurrent unrelated operation', async () => {
    const seenInsideWrapped = { value: false };
    const seenInsideBare = { value: true }; // starts wrong; only false proves isolation

    await Promise.all([
      withLLMContext(async () => {
        await sleep(20);
        seenInsideWrapped.value = isInLLMContext();
      }),
      (async () => {
        // A totally unrelated concurrent operation, mid-flight while the LLM
        // operation above is still awaiting — never entered any context.
        await sleep(5);
        seenInsideBare.value = isInLLMContext();
      })(),
    ]);

    expect(seenInsideWrapped.value).toBe(true);
    expect(seenInsideBare.value).toBe(false);
  });

  it('does not let a concurrent trusted-context operation mask an unrelated LLM-context bypass', async () => {
    let bypassWasCaught = false;

    await Promise.all([
      // Simulates a concurrent approval-engine apply holding trusted context
      // open across an await (exactly applyBundle's shape, which itself uses
      // withTrustedContext — using it here too, not the imperative pair,
      // since that's what closes this gap: see write-guard.ts's docstring).
      withTrustedContext(async () => {
        await sleep(20);
      }),
      // A completely unrelated LLM-context write that bypasses the approval
      // engine. Under the old shared counter, op A's concurrent trusted
      // context would have masked this — the guard would have stayed silent.
      withLLMContext(async () => {
        await sleep(5);
        try {
          checkLLMWriteGuard('indexNote');
        } catch {
          bypassWasCaught = true;
        }
      }),
    ]);

    expect(bypassWasCaught).toBe(true);
  });
});
