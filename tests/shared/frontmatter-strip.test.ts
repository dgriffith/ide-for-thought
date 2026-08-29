/**
 * Canonical `stripFrontmatter` (#1917), hoisted from 6 duplicated copies.
 * CRLF-aware — see the module docstring for why that's the canonical
 * behavior rather than the narrower LF-only variant one copy had.
 */
import { describe, it, expect } from 'vitest';
import { stripFrontmatter } from '../../src/shared/frontmatter-strip';

describe('stripFrontmatter (#1917)', () => {
  it('strips a leading frontmatter block', () => {
    expect(stripFrontmatter('---\ntitle: X\n---\nBody text.\n')).toBe('Body text.\n');
  });

  it('strips a CRLF frontmatter block', () => {
    expect(stripFrontmatter('---\r\ntitle: X\r\n---\r\nBody text.\r\n')).toBe('Body text.\r\n');
  });

  it('leaves content with no frontmatter untouched', () => {
    expect(stripFrontmatter('# Just a note\n\nNo frontmatter here.\n')).toBe('# Just a note\n\nNo frontmatter here.\n');
  });

  it('does not strip a --- that is not at the very start', () => {
    expect(stripFrontmatter('Body first.\n---\ntitle: X\n---\n')).toBe('Body first.\n---\ntitle: X\n---\n');
  });

  it('handles a frontmatter block with no trailing newline after the closing ---', () => {
    expect(stripFrontmatter('---\ntitle: X\n---')).toBe('');
  });
});
