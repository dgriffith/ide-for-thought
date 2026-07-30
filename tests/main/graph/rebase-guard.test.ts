/**
 * Base-IRI rebase validation (#1443 Part B) — unit-tested in isolation from the
 * IPC handler / live graph. (The review-queue no longer blocks a rebase:
 * proposals are rewritten old→new during the rebuild — see the
 * indexAllNotes-rebase test.)
 */
import { describe, it, expect } from 'vitest';
import { checkRebase } from '../../../src/main/graph/rebase-guard';

describe('checkRebase', () => {
  it('accepts a trimmed absolute http(s) IRI ending in "/"', () => {
    expect(checkRebase('  https://project.minerva.dev/u/p/  ')).toEqual({ ok: true, uri: 'https://project.minerva.dev/u/p/' });
    expect(checkRebase('http://localhost:8080/base/')).toEqual({ ok: true, uri: 'http://localhost:8080/base/' });
  });

  it('rejects a malformed base IRI', () => {
    for (const bad of ['', 'not-a-url', 'ftp://x/', 'https://no-trailing-slash', 'https://x /base/']) {
      const r = checkRebase(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/absolute http/i);
    }
  });
});
