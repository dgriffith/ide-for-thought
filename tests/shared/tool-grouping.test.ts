import { describe, it, expect } from 'vitest';
import { groupToolsByGroup, hasNamedGroups, type GroupableTool } from '../../src/shared/tools/grouping';

const t = (id: string, group?: string): GroupableTool & { id: string } => ({ id, group });

describe('groupToolsByGroup', () => {
  it('returns a single null bucket when nothing is grouped (flat)', () => {
    const groups = groupToolsByGroup([t('a'), t('b'), t('c')]);
    expect(groups).toEqual([{ label: null, tools: [t('a'), t('b'), t('c')] }]);
    expect(hasNamedGroups(groups)).toBe(false);
  });

  it('partitions by group in first-appearance order', () => {
    const groups = groupToolsByGroup([
      t('a', 'Generation'),
      t('b', 'Planning'),
      t('c', 'Generation'),
      t('d', 'Planning'),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['Generation', 'Planning']);
    expect(groups[0].tools.map((x) => (x as { id: string }).id)).toEqual(['a', 'c']);
    expect(groups[1].tools.map((x) => (x as { id: string }).id)).toEqual(['b', 'd']);
    expect(hasNamedGroups(groups)).toBe(true);
  });

  it('collects ungrouped tools into a trailing null bucket, even if they appear first', () => {
    const groups = groupToolsByGroup([
      t('loose1'),
      t('a', 'Planning'),
      t('loose2'),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['Planning', null]);
    expect(groups[1].tools.map((x) => (x as { id: string }).id)).toEqual(['loose1', 'loose2']);
  });

  it('omits the null bucket when every tool is grouped', () => {
    const groups = groupToolsByGroup([t('a', 'X'), t('b', 'Y')]);
    expect(groups.map((g) => g.label)).toEqual(['X', 'Y']);
    expect(groups.every((g) => g.label !== null)).toBe(true);
  });
});
