import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/minerva/canonical-wiki-link-path-style';
import { formatContent } from '../../../../../src/shared/formatter/engine';
import type { FormatContext } from '../../../../../src/shared/formatter/types';

const enabled = { enabled: { 'canonical-wiki-link-path-style': true }, configs: {} };

/** Stub resolver: `raft` and `journey/raft` canonicalise to `notes/topic/raft`;
 *  everything else is unresolvable (returns null → left alone). */
const ctx: FormatContext = {
  canonicalizeLinkTarget: (target) =>
    target === 'raft' || target === 'journey/raft' ? 'notes/topic/raft' : null,
};

describe('canonical-wiki-link-path-style (#778)', () => {
  it('rewrites a short note link to the canonical target', () => {
    expect(formatContent('see [[raft]] here', enabled, ctx)).toBe('see [[notes/topic/raft]] here');
  });

  it('preserves type prefix, anchor, and display', () => {
    expect(formatContent('[[supports::raft#methods|the raft paper]]', enabled, ctx))
      .toBe('[[supports::notes/topic/raft#methods|the raft paper]]');
  });

  it('leaves already-canonical links unchanged', () => {
    expect(formatContent('[[notes/topic/raft]]', enabled, ctx)).toBe('[[notes/topic/raft]]');
  });

  it('leaves unresolvable links alone', () => {
    expect(formatContent('[[some/other/note]]', enabled, ctx)).toBe('[[some/other/note]]');
  });

  it('skips cite:: / quote:: links (sources / excerpts, not notes)', () => {
    // Even though "raft" would resolve, cite:: targets a source — untouched.
    expect(formatContent('[[cite::raft]] and [[quote::raft]]', enabled, ctx))
      .toBe('[[cite::raft]] and [[quote::raft]]');
  });

  it('does not rewrite inside fenced code', () => {
    const src = '```\n[[raft]]\n```\n';
    expect(formatContent(src, enabled, ctx)).toBe(src);
  });

  it('no-ops without the resolver context', () => {
    expect(formatContent('[[raft]]', enabled)).toBe('[[raft]]');
  });

  it('is off by default (not in the house style)', () => {
    expect(formatContent('[[raft]]', { enabled: {}, configs: {} }, ctx)).toBe('[[raft]]');
  });
});
