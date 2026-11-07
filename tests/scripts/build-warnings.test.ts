import { describe, it, expect, vi } from 'vitest';
import { isKnownHarmlessWarning, onwarn } from '../../scripts/lib/build-warnings.mjs';

const CSSOM = '/repo/node_modules/@acemir/cssom/lib/errorUtils.js';

describe('known-harmless build warnings (#2977)', () => {
  it("drops rolldown's EVAL warning for @acemir/cssom's errorUtils, as rolldown reports it", () => {
    // The shape rolldown 1.2 emits (checked by bundling the module).
    expect(isKnownHarmlessWarning({ code: 'EVAL', id: CSSOM, loc: { file: CSSOM }, message: '…', pos: 1 })).toBe(true);
    expect(isKnownHarmlessWarning({ code: 'EVAL', loc: { file: CSSOM } })).toBe(true);
    expect(isKnownHarmlessWarning({ code: 'EVAL', id: 'C:\\repo\\node_modules\\@acemir\\cssom\\lib\\errorUtils.js' })).toBe(true);
  });

  it('keeps an EVAL anywhere else, and any other warning from that module', () => {
    expect(isKnownHarmlessWarning({ code: 'EVAL', id: '/repo/src/main/thing.ts' })).toBe(false);
    expect(isKnownHarmlessWarning({ code: 'EVAL', id: '/repo/node_modules/@acemir/cssom/lib/parse.js' })).toBe(false);
    expect(isKnownHarmlessWarning({ code: 'CIRCULAR_DEPENDENCY', id: CSSOM })).toBe(false);
    expect(isKnownHarmlessWarning({ code: 'EVAL' })).toBe(false);
  });

  it('onwarn passes everything else on', () => {
    const warn = vi.fn();
    onwarn({ code: 'EVAL', id: CSSOM }, warn);
    onwarn({ code: 'EVAL', id: '/repo/src/x.ts' }, warn);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatchObject({ id: '/repo/src/x.ts' });
  });
});
