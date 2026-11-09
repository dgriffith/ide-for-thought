/**
 * @vitest-environment happy-dom
 *
 * Timeline and Calendar draw in time order, so that is the order a ⇧-click
 * range runs in and Export CSV writes (#2942) — not the view's title order.
 */
import { describe, it, expect } from 'vitest';
import { layoutOrder } from '../../../src/renderer/lib/components/type-view/layout-renderers';
import type { LayoutView } from '../../../src/renderer/lib/components/type-view/layout-view';

const row = (path: string, date: string | null) => ({ path, title: path.replace('.md', ''), values: { date }, cover: null });
const view = {
  instances: [row('Alpha.md', '2026-10-09'), row('Beta.md', null), row('Gamma.md', '2026-10-02'), row('Delta.md', '2026-10-05')],
  dateBy: null,
  properties: [{ name: 'date', label: 'Date', type: 'date' }],
} as unknown as LayoutView;

describe('layoutOrder for the time layouts (#2942)', () => {
  it('Timeline and Calendar: by date, Undated last', () => {
    for (const layout of ['timeline', 'calendar'] as const) {
      expect(layoutOrder(layout, view).map((i) => i.path)).toEqual(['Gamma.md', 'Delta.md', 'Alpha.md', 'Beta.md']);
    }
  });

  it('the others are unchanged: List draws the view\'s own order', () => {
    expect(layoutOrder('list', view).map((i) => i.path)).toEqual(['Alpha.md', 'Beta.md', 'Gamma.md', 'Delta.md']);
  });
});
