/**
 * The mindmap's layout at 1,000 nodes (#2964), both orientations — the
 * story's scale target. New benches only warn until blessed on CI.
 */
import { describe, test } from 'vitest';
import { layoutMindmap, type MindmapTree } from '../../../src/shared/mindmap/mindmap-layout';
import { assertFixtureReaches } from '../../helpers/bench-fixture';

/** An outline's shape: 10 sections of 10 sub-points of 9 notes each, labels of ordinary length. */
function outline(): MindmapTree {
  let n = 0;
  const node = (depth: number, fanout: number[]): MindmapTree => ({
    id: `n${n++}`,
    label: `Point ${n} about something worth a few words`,
    children: depth >= fanout.length ? [] : Array.from({ length: fanout[depth]! }, () => node(depth + 1, fanout)),
  });
  return node(0, [10, 10, 9]);
}

const tree = outline();
let total = 0;
let longest = 0;
const walk = (t: MindmapTree) => { total++; longest = Math.max(longest, t.label.length); t.children.forEach(walk); };
walk(tree);
assertFixtureReaches('the outline holds about 1,000 nodes', total >= 1000, total);
assertFixtureReaches('its labels are long enough to wrap at the 220px maximum', longest * 7 > 220, longest);

for (const orientation of ['ltr', 'radial'] as const) {
  describe(`mindmap layout — ${total} nodes, ${orientation}`, () => {
    test(`layoutMindmap: ${total} nodes, ${orientation}`, async ({ bench }) => {
      await bench(`layoutMindmap: ${total} nodes, ${orientation}`, () => {
        layoutMindmap(tree, { orientation });
      }).run({ iterations: 20, time: 0 });
    });
  });
}
