import { describe, it, expect } from 'vitest';
import { removeBrokenAnchorLinks } from '../../src/shared/refactor/remove-broken-anchor';

const files = [
  { relativePath: 'notes/topic/raft.md', isDirectory: false },
  { relativePath: 'notes/other.md', isDirectory: false },
];

// Strip the broken `#consensus` anchor from links that resolve to raft.md.
function strip(content: string): string {
  return removeBrokenAnchorLinks(content, files, undefined, 'notes/topic/raft.md', 'consensus');
}

describe('removeBrokenAnchorLinks (#1446)', () => {
  it('drops the anchor from a bare-basename link to the target note', () => {
    expect(strip('see [[raft#consensus]] here')).toBe('see [[raft]] here');
  });

  it('drops the anchor from a full-path link', () => {
    expect(strip('[[notes/topic/raft#consensus]]')).toBe('[[notes/topic/raft]]');
  });

  it('preserves display text and type prefix', () => {
    expect(strip('[[raft#consensus|the paper]]')).toBe('[[raft|the paper]]');
    expect(strip('[[supports::raft#consensus]]')).toBe('[[supports::raft]]');
  });

  it('matches the anchor by slug (raw heading text in the link)', () => {
    // The link author wrote the human heading; the inspection anchor is a slug.
    expect(strip('[[raft#Consensus]]')).toBe('[[raft]]');
  });

  it('leaves the same anchor on a DIFFERENT note untouched', () => {
    expect(strip('[[other#consensus]]')).toBe('[[other#consensus]]');
  });

  it('leaves a different anchor on the target note untouched', () => {
    expect(strip('[[raft#leader-election]]')).toBe('[[raft#leader-election]]');
  });

  it('leaves cite:: / quote:: links untouched', () => {
    expect(strip('[[cite::raft#consensus]]')).toBe('[[cite::raft#consensus]]');
  });

  it('leaves block-id anchors untouched', () => {
    expect(strip('[[raft#^blockid]]')).toBe('[[raft#^blockid]]');
  });

  it('strips every matching occurrence in the note', () => {
    expect(strip('[[raft#consensus]] and again [[raft#consensus|x]]')).toBe('[[raft]] and again [[raft|x]]');
  });

  it('leaves anchorless links and non-target links alone', () => {
    expect(strip('[[raft]] and [[other]] and text')).toBe('[[raft]] and [[other]] and text');
  });
});
