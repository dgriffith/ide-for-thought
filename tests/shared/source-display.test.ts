/**
 * displaySourceTitle — central helper for picking a user-facing label
 * for a Source. Canonical ids (`url-<hash>`, `sha-<hash>`, …) are
 * filesystem-only and must never reach the UI.
 */

import { describe, it, expect } from 'vitest';
import { displaySourceTitle } from '../../src/shared/source-display';

describe('displaySourceTitle', () => {
  it('uses the title when present', () => {
    expect(displaySourceTitle({ title: 'On the dangers of stochastic parrots', uri: null, doi: null }))
      .toBe('On the dangers of stochastic parrots');
  });

  it('trims whitespace from the title', () => {
    expect(displaySourceTitle({ title: '  Title with padding  ', uri: null, doi: null }))
      .toBe('Title with padding');
  });

  it('treats an empty-string title as missing and falls back', () => {
    expect(displaySourceTitle({ title: '', uri: 'https://example.com/paper', doi: null }))
      .toBe('example.com/paper');
  });

  it('treats whitespace-only title as missing', () => {
    expect(displaySourceTitle({ title: '   ', uri: 'https://example.com/x', doi: null }))
      .toBe('example.com/x');
  });

  it('cleans a URL — strips scheme and leading www', () => {
    expect(displaySourceTitle({ title: null, uri: 'https://www.example.com/papers/2026', doi: null }))
      .toBe('example.com/papers/2026');
  });

  it('drops a trailing slash from the cleaned URL', () => {
    expect(displaySourceTitle({ title: null, uri: 'https://example.com/papers/', doi: null }))
      .toBe('example.com/papers');
  });

  it('hides the empty pathname for a bare hostname', () => {
    expect(displaySourceTitle({ title: null, uri: 'https://example.com', doi: null }))
      .toBe('example.com');
  });

  it('falls back to the raw string for non-URL URIs', () => {
    expect(displaySourceTitle({ title: null, uri: 'not-a-url', doi: null }))
      .toBe('not-a-url');
  });

  it('uses the DOI when title and URI are missing', () => {
    expect(displaySourceTitle({ title: null, uri: null, doi: '10.1145/3678002' }))
      .toBe('DOI 10.1145/3678002');
  });

  it('prefers title > URI > DOI > Untitled', () => {
    expect(displaySourceTitle({ title: 'T', uri: 'https://u', doi: '10.1/x' })).toBe('T');
    expect(displaySourceTitle({ title: null, uri: 'https://u', doi: '10.1/x' })).toBe('u');
    expect(displaySourceTitle({ title: null, uri: null, doi: '10.1/x' })).toBe('DOI 10.1/x');
    expect(displaySourceTitle({ title: null, uri: null, doi: null })).toBe('Untitled source');
  });

  it('never returns a canonical-id-style string for the no-metadata case', () => {
    // The whole point of the helper: nothing it returns should look
    // like `url-<hash>` / `sha-<hash>` / etc. — those are filesystem
    // ids and must never reach the UI.
    const out = displaySourceTitle({ title: null, uri: null, doi: null });
    expect(out).not.toMatch(/^url-/);
    expect(out).not.toMatch(/^sha-/);
    expect(out).not.toMatch(/^doi-/);
  });
});
