import { describe, it, expect } from 'vitest';
import {
  groupToolsByGroup,
  hasNamedGroups,
  flattenGroupedMenu,
  type GroupableTool,
} from '../../src/shared/tools/grouping';

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

describe('flattenGroupedMenu (nest named, inline ungrouped)', () => {
  // Render each tool as `id` and each submenu as `Label>[ids]` so ordering +
  // nesting are legible in one string per item.
  const flat = (x: GroupableTool & { id: string }) => x.id;
  const submenu = (label: string, ts: (GroupableTool & { id: string })[]) =>
    `${label}>[${ts.map((x) => x.id).join(',')}]`;
  const render = (tools: (GroupableTool & { id: string })[]) =>
    flattenGroupedMenu(groupToolsByGroup(tools), flat, submenu);

  it('renders a fully-ungrouped menu flat', () => {
    expect(render([t('a'), t('b'), t('c')])).toEqual(['a', 'b', 'c']);
  });

  it('nests only the grouped skill; ungrouped stay inline (the gotcha scenario)', () => {
    // One skill grouped among three ungrouped: just that skill nests. The
    // others are NOT swept into a "General" submenu.
    expect(render([t('a'), t('b', 'Planning'), t('c')])).toEqual([
      'Planning>[b]',
      'a',
      'c',
    ]);
  });

  it('nests each named group and keeps the trailing ungrouped bucket inline', () => {
    expect(render([
      t('a', 'Generation'),
      t('b', 'Planning'),
      t('c', 'Generation'),
      t('loose'),
    ])).toEqual(['Generation>[a,c]', 'Planning>[b]', 'loose']);
  });
});
