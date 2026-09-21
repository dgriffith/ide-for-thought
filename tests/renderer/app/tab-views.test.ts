/**
 * Per-group view instances, after the four parallel maps became one structure
 * (#2236 PR 2/2, epic #2241).
 *
 * App.svelte held `editorComponents`, `previewComponents`,
 * `queryPanelComponents` and `neighborhoodGraphComponents` — four
 * `Record<string, Component | undefined>` maps keyed by editor-group id, each
 * with its own `$state` and its own `$derived` accessor. The `Tab` union has
 * seven members, so a new view kind meant a fifth of each.
 *
 * The line saving is small and the issue oversold it. What the consolidation
 * actually fixes is `updateThemeAll`, and the bug it found on the way: the old
 * theme re-skin called `updateTheme()` on the four accessors, every one of
 * which resolves to the ACTIVE group — so with a split pane open, the
 * unfocused group kept the old theme until it remounted. The first case below
 * is that bug; the rest pin the properties that make forgetting a view kind
 * impossible rather than merely unlikely.
 */
import { describe, it, expect } from 'vitest';
import {
  createTabViews,
  allViews,
  allEditors,
  updateThemeAll,
  type TabViews,
} from '../../../src/renderer/lib/app/tab-views.svelte';

/** A stand-in for a mounted component: records whether it got re-skinned. */
function view(): { updateTheme: () => void; themed: number } {
  const v = { themed: 0, updateTheme: () => { v.themed += 1; } };
  return v;
}

/** Cast helper — the maps are typed to real Svelte components, and these
 *  tests only care about the structural `updateTheme` contract. */
const as = <T,>(v: unknown): T => v as T;

describe('updateThemeAll — every mounted pane, not just the focused one', () => {
  it('re-skins views in EVERY group, which the four named accessors did not', () => {
    // The regression this encodes: `editorComponent` and friends were
    // `$derived(map[activeGroupId])`, so a second split pane was skipped.
    const views: TabViews = createTabViews();
    const active = view();
    const other = view();
    views.editor['group-a'] = as(active);
    views.editor['group-b'] = as(other);

    updateThemeAll(views);

    expect(active.themed).toBe(1);
    expect(other.themed).toBe(1);
  });

  it('re-skins every KIND, so a new view kind cannot be forgotten', () => {
    // The other half: the old form named each kind in a hand-written call
    // list. This walks the structure, so a kind added to `TabViews` is
    // included without anyone remembering to add a line here.
    const views: TabViews = createTabViews();
    const e = view(); const p = view(); const q = view(); const g = view();
    views.editor['g'] = as(e);
    views.preview['g'] = as(p);
    views.query['g'] = as(q);
    views.graph['g'] = as(g);

    updateThemeAll(views);

    expect([e.themed, p.themed, q.themed, g.themed]).toEqual([1, 1, 1, 1]);
  });

  it('is a no-op with nothing mounted', () => {
    expect(() => updateThemeAll(createTabViews())).not.toThrow();
  });
});

describe('allViews', () => {
  it('skips unmounted slots rather than yielding undefined', () => {
    // A group's slot is set to undefined when its pane unmounts; callers
    // iterate the result directly and must not have to null-check.
    const views: TabViews = createTabViews();
    views.editor['g'] = as(view());
    views.preview['g'] = undefined;
    expect(allViews(views)).toHaveLength(1);
  });

  it('includes an editor AND a preview from the same group', () => {
    // `editor-preview` view mode mounts both in one group — which is why this
    // models slots rather than one map keyed by the Tab union's `type`, as the
    // issue suggested.
    const views: TabViews = createTabViews();
    views.editor['g'] = as(view());
    views.preview['g'] = as(view());
    expect(allViews(views)).toHaveLength(2);
  });

  it('is empty for a fresh structure', () => {
    expect(allViews(createTabViews())).toEqual([]);
  });
});

describe('allEditors', () => {
  it('returns only editors, across groups', () => {
    // Font size is CodeMirror's, so this one stays kind-specific rather than
    // joining the structural sweep.
    const views: TabViews = createTabViews();
    const a = view(); const b = view();
    views.editor['g1'] = as(a);
    views.editor['g2'] = as(b);
    views.preview['g1'] = as(view());
    views.query['g1'] = as(view());

    expect(allEditors(views)).toHaveLength(2);
  });

  it('drops unmounted slots', () => {
    const views: TabViews = createTabViews();
    views.editor['g1'] = as(view());
    views.editor['g2'] = undefined;
    expect(allEditors(views)).toHaveLength(1);
  });
});

describe('createTabViews', () => {
  it('gives every kind an always-present map, which is what bind:this needs', () => {
    // `bind:this={tabViews.editor[groupId]}` assigns into an existing object.
    // A lazily-created per-kind map would have to exist before the pane mounts.
    const views = createTabViews();
    expect(Object.keys(views).sort()).toEqual(['editor', 'graph', 'preview', 'query']);
    for (const byGroup of Object.values(views)) expect(byGroup).toEqual({});
  });

  it('hands back a fresh structure each call — no shared module state', () => {
    const a = createTabViews();
    const b = createTabViews();
    a.editor['g'] = as(view());
    expect(allViews(b)).toEqual([]);
  });
});
