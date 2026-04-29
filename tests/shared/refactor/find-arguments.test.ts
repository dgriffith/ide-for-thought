/**
 * Coverage for `extractClaimUri` — the only piece of the original
 * one-shot Find-Arguments tool that survived the conversational
 * rework. Used by the editor's right-click menu to gate the
 * conversational tools on the cursor sitting on a claim line.
 */

import { describe, it, expect } from 'vitest';
import { extractClaimUri } from '../../../src/shared/refactor/find-arguments';

describe('extractClaimUri', () => {
  it('finds an angle-bracketed claim URI on the line', () => {
    expect(extractClaimUri('something something <https://minerva.dev/c/claim-abc-123> trailing'))
      .toBe('https://minerva.dev/c/claim-abc-123');
  });

  it('finds a bare claim URI', () => {
    expect(extractClaimUri('cf https://minerva.dev/c/claim-xyz'))
      .toBe('https://minerva.dev/c/claim-xyz');
  });

  it('returns null when nothing matches', () => {
    expect(extractClaimUri('plain prose with no URI in sight')).toBeNull();
  });

  it('returns null for non-claim Minerva URIs', () => {
    // `…/c/grounds-foo` is the Grounds shape, not a claim.
    expect(extractClaimUri('<https://minerva.dev/c/grounds-foo>')).toBeNull();
  });
});
