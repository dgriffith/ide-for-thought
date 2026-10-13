/**
 * What an agent reads about the extension points (#2619): the list in ladder
 * order, the filters, one point in full, and descriptions that lead with the
 * ladder so "how do I…" starts at the cheapest rung.
 */
import { describe, it, expect } from 'vitest';
import {
  DESCRIBE_EXTENSION_POINT_DESCRIPTION,
  LIST_EXTENSION_POINTS_DESCRIPTION,
  describeExtensionPoint,
  listExtensionPoints,
} from '../../../src/shared/extensions/describe';
import { EXTENSION_POINTS, RUNGS } from '../../../src/shared/extensions/points';

describe('listExtensionPoints', () => {
  it('lists every point, cheapest rung first', () => {
    const r = listExtensionPoints();
    if (!r.ok) throw new Error(r.error);
    expect(r.points).toHaveLength(EXTENSION_POINTS.length);
    const ranks = r.points.map((p) => RUNGS.indexOf(p.rung));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(r.points[0]?.rung).toBe('setting');
  });

  it('filters to one rung, or to the points open today', () => {
    const skills = listExtensionPoints({ rung: 'skill' });
    expect(skills.ok && skills.points.map((p) => p.id)).toEqual(['skills']);
    const open = listExtensionPoints({ openOnly: true });
    expect(open.ok && open.points.every((p) => p.rung !== 'source')).toBe(true);
    expect(open.ok && open.points.map((p) => p.id)).toContain('mcp-servers');
  });

  it('names the rungs when asked for one that does not exist', () => {
    const r = listExtensionPoints({ rung: 'magic' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('setting, skill');
  });
});

describe('describeExtensionPoint', () => {
  it('gives one point in full', () => {
    const r = describeExtensionPoint('skills');
    expect(r.ok && r.point.contract).toMatchObject({ kind: 'parser', at: { symbol: 'parseSkill' } });
    expect(r.ok && r.point.docs).toBe('docs/authoring-skills.md');
  });

  it('lists the ids there are when the id is unknown', () => {
    const r = describeExtensionPoint('nope');
    expect(!r.ok && r.error).toContain('object-types');
  });
});

describe('the tool descriptions', () => {
  it('lead with the ladder, cheapest rung first', () => {
    for (const d of [LIST_EXTENSION_POINTS_DESCRIPTION, DESCRIBE_EXTENSION_POINT_DESCRIPTION]) {
      expect(d).toContain('setting → skill → object-type');
      expect(d).toMatch(/LOWEST rung/);
    }
  });
});
