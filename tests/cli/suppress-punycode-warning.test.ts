/**
 * The CLI's punycode-deprecation mask must be SURGICAL: it drops only DEP0040,
 * and every other warning still reaches Node's real emitter. This guards against
 * the override quietly swallowing all warnings.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const realEmit = process.emitWarning;
let downstream: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  // Stand in a spy as the "real" emitter BEFORE importing the module, so the
  // module binds `original` to our spy; then it replaces process.emitWarning
  // with its filtering wrapper.
  downstream = vi.fn();
  process.emitWarning = downstream as unknown as typeof process.emitWarning;
  vi.resetModules();
  await import('../../src/cli/suppress-punycode-warning');
});

afterEach(() => {
  process.emitWarning = realEmit;
  vi.resetModules();
});

describe('suppress-punycode-warning (CLI)', () => {
  it('swallows the punycode deprecation by message', () => {
    process.emitWarning('The `punycode` module is deprecated.', 'DeprecationWarning', 'DEP0040');
    expect(downstream).not.toHaveBeenCalled();
  });

  it('swallows by the DEP0040 code even if the message changes', () => {
    process.emitWarning('something else entirely', 'DeprecationWarning', 'DEP0040');
    expect(downstream).not.toHaveBeenCalled();
  });

  it('swallows the object-options form ({ code: DEP0040 })', () => {
    process.emitWarning('x', { type: 'DeprecationWarning', code: 'DEP0040' });
    expect(downstream).not.toHaveBeenCalled();
  });

  it('passes every OTHER warning through untouched', () => {
    process.emitWarning('a normal warning');
    process.emitWarning('another deprecation', 'DeprecationWarning', 'DEP9999');
    expect(downstream).toHaveBeenCalledTimes(2);
  });
});
