import { describe, it, expect } from 'vitest';
import { hostOf } from '../../src/renderer/lib/conversations/citations';

describe('hostOf', () => {
  it('returns the bare host, stripping scheme and www.', () => {
    expect(hostOf('https://www.nature.com/articles/x')).toBe('nature.com');
    expect(hostOf('http://example.org/page?q=1')).toBe('example.org');
    expect(hostOf('https://sub.domain.io')).toBe('sub.domain.io');
  });

  it('falls back to the raw string for an unparseable URL', () => {
    expect(hostOf('not a url')).toBe('not a url');
    expect(hostOf('')).toBe('');
  });
});
