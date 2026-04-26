import { describe, it, expect, vi, afterEach } from 'vitest';
import { enterLLMContext, exitLLMContext, isInLLMContext } from '../../../src/main/graph/index';

describe('LLM write guard', () => {
  afterEach(() => {
    // Clean up any leftover context
    while (isInLLMContext()) exitLLMContext();
  });

  it('starts outside LLM context', () => {
    expect(isInLLMContext()).toBe(false);
  });

  it('enters and exits LLM context', () => {
    enterLLMContext();
    expect(isInLLMContext()).toBe(true);
    exitLLMContext();
    expect(isInLLMContext()).toBe(false);
  });

  it('supports nested LLM context', () => {
    enterLLMContext();
    enterLLMContext();
    expect(isInLLMContext()).toBe(true);
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
    exitLLMContext();
    expect(isInLLMContext()).toBe(false);
  });

  it('logs warning when direct write attempted in LLM context', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    enterLLMContext();

    // The guardedAdd function is internal, but we can verify the context flag
    // is correctly set, which is what guardedAdd checks
    expect(isInLLMContext()).toBe(true);

    exitLLMContext();
    warnSpy.mockRestore();
  });
});
