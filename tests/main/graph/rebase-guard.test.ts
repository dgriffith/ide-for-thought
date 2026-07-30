/**
 * Base-IRI rebase precheck (#1443 Part B) — the validation + the review-queue
 * invariant, unit-tested in isolation from the IPC handler / live graph.
 */
import { describe, it, expect } from 'vitest';
import { checkRebase } from '../../../src/main/graph/rebase-guard';

describe('checkRebase', () => {
  it('accepts a trimmed absolute http(s) IRI ending in "/" when the queue is empty', () => {
    expect(checkRebase('  https://project.minerva.dev/u/p/  ', 0)).toEqual({ ok: true, uri: 'https://project.minerva.dev/u/p/' });
    expect(checkRebase('http://localhost:8080/base/', 0)).toEqual({ ok: true, uri: 'http://localhost:8080/base/' });
  });

  it('rejects a malformed base IRI', () => {
    for (const bad of ['', 'not-a-url', 'ftp://x/', 'https://no-trailing-slash', 'https://x /base/']) {
      const r = checkRebase(bad, 0);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/absolute http/i);
    }
  });

  it('refuses while the review queue is non-empty (the #1 invariant), even for a valid IRI', () => {
    const r = checkRebase('https://project.minerva.dev/u/p/', 3);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/3 pending proposals.*review queue/i);
  });

  it('singularises the refusal message for one pending proposal', () => {
    const r = checkRebase('https://x/base/', 1);
    if (!r.ok) expect(r.error).toMatch(/1 pending proposal in/i);
  });
});
