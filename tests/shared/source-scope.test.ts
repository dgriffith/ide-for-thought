/**
 * `isSourceScoped` (#103) — the single predicate that keeps source tools in the
 * Source viewer and out of the note menus / editor right-click / palette.
 */
import { describe, it, expect } from 'vitest';
import { isSourceScoped } from '../../src/shared/tools/types';

describe('isSourceScoped', () => {
  it('is true only for scope: source', () => {
    expect(isSourceScoped({ scope: 'source' })).toBe(true);
  });

  it('is false for note scope and for an absent scope (the default)', () => {
    expect(isSourceScoped({ scope: 'note' })).toBe(false);
    expect(isSourceScoped({})).toBe(false);
  });

  it('partitions a mixed tool list — note surfaces keep only note tools', () => {
    const tools = [
      { id: 'a', scope: undefined },
      { id: 'b', scope: 'note' as const },
      { id: 'c', scope: 'source' as const },
    ];
    expect(tools.filter((t) => !isSourceScoped(t)).map((t) => t.id)).toEqual(['a', 'b']);
    expect(tools.filter((t) => isSourceScoped(t)).map((t) => t.id)).toEqual(['c']);
  });
});
