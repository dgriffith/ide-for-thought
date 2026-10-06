/**
 * @vitest-environment happy-dom
 *
 * (happy-dom because the embed parser's module also holds the Svelte mount code.)
 *
 * An object-view embed's `height` (#2666): parsed with a clamp, omitted at the
 * 360 default, round-tripped through Save as note / Copy as markdown, and
 * rewritten in place by the resize handle.
 */
import { describe, it, expect } from 'vitest';
import {
  OBJECT_VIEW_DEFAULT_HEIGHT, OBJECT_VIEW_MAX_HEIGHT, OBJECT_VIEW_MIN_HEIGHT,
  applyObjectViewHeight, parseViewHeight, setViewHeightInSpec,
} from '../../../src/shared/objects/view-height';
import { buildViewEmbed } from '../../../src/shared/objects/view-note';
import { parseObjectViewSpec } from '../../../src/renderer/lib/markdown/object-view-renderer';

const fenceBody = (embed: string) => embed.split('\n').slice(1, -2).join('\n');

describe('parseViewHeight', () => {
  it('defaults and clamps', () => {
    expect(parseViewHeight(undefined)).toBe(OBJECT_VIEW_DEFAULT_HEIGHT);
    expect(parseViewHeight('500')).toBe(OBJECT_VIEW_DEFAULT_HEIGHT);
    expect(parseViewHeight(10)).toBe(OBJECT_VIEW_MIN_HEIGHT);
    expect(parseViewHeight(1e9)).toBe(OBJECT_VIEW_MAX_HEIGHT);
    expect(parseViewHeight(480.4)).toBe(480);
  });
});

describe('spec round-trip', () => {
  const base = { typeId: 'place', layout: 'map' as const, sortColumn: null, sortDir: 'asc' as const, columns: null };

  it('writes a non-default height and reads it back', () => {
    const embed = buildViewEmbed({ ...base, height: 520 });
    expect(embed).toContain('"height": 520');
    expect(parseObjectViewSpec(fenceBody(embed)).height).toBe(520);
  });
  it('omits the default, so existing embeds are unchanged', () => {
    expect(buildViewEmbed({ ...base, height: 360 })).toBe(buildViewEmbed(base));
    expect(buildViewEmbed(base)).not.toContain('height');
    expect(parseObjectViewSpec(fenceBody(buildViewEmbed(base))).height).toBe(OBJECT_VIEW_DEFAULT_HEIGHT);
  });
});

describe('setViewHeightInSpec', () => {
  it('adds to a one-line spec, keeping it on one line', () => {
    expect(setViewHeightInSpec('{"typeId":"place","layout":"list"}', 500)).toBe('{"typeId":"place","layout":"list","height":500}');
  });
  it('adds to a pretty-printed spec as one line', () => {
    expect(setViewHeightInSpec('{\n  "typeId": "place",\n  "layout": "list"\n}', 500))
      .toBe('{\n  "typeId": "place",\n  "layout": "list",\n  "height": 500\n}');
  });
  it('replaces and removes in place', () => {
    expect(setViewHeightInSpec('{"typeId": "p", "height": 400, "layout": "map"}', 600)).toBe('{"typeId": "p", "height": 600, "layout": "map"}');
    expect(setViewHeightInSpec('{"typeId": "p", "height": 400, "layout": "map"}', null)).toBe('{"typeId": "p", "layout": "map"}');
    expect(setViewHeightInSpec('{"typeId": "p", "layout": "map", "height": 400}', 360)).toBe('{"typeId": "p", "layout": "map"}');
  });
  it('is unchanged when already at the default with none written', () => {
    expect(setViewHeightInSpec('{"typeId":"p","layout":"map"}', null)).toBe('{"typeId":"p","layout":"map"}');
  });
  it('refuses a body that is not a JSON object', () => {
    expect(setViewHeightInSpec('not json', 500)).toBeNull();
  });
});

describe('applyObjectViewHeight', () => {
  const note = '---\nt: 1\n---\n# N\n\n```object-view\n{"typeId":"place","layout":"map"}\n```\n\nafter\n';
  it('rewrites the fence that opens on the line', () => {
    expect(applyObjectViewHeight(note, 6, 480)).toBe(note.replace('"layout":"map"}', '"layout":"map","height":480}'));
  });
  it('writes nothing when that line is not an object-view fence', () => {
    expect(applyObjectViewHeight(note, 5, 480)).toBeNull();
    expect(applyObjectViewHeight(note, 60, 480)).toBeNull();
  });
});
