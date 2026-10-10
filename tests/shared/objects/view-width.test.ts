/**
 * @vitest-environment happy-dom
 *
 * (happy-dom because the embed parser's module also holds the Svelte mount code.)
 *
 * An object-view embed's `width` (#2709): parsed with a clamp, omitted when it
 * fills the column, round-tripped through Save as note / Copy as markdown, and
 * rewritten in place by the resize handle without disturbing `height`.
 */
import { describe, it, expect } from 'vitest';
import {
  OBJECT_VIEW_MAX_WIDTH, OBJECT_VIEW_MIN_WIDTH,
  applyObjectViewWidth, parseViewWidth, setViewWidthInSpec,
} from '../../../src/shared/objects/view-width';
import { applyObjectViewHeight } from '../../../src/shared/objects/view-height';
import { buildViewEmbed } from '../../../src/shared/objects/view-note';
import { parseObjectViewSpec } from '../../../src/renderer/lib/markdown/object-view-renderer';

const fenceBody = (embed: string) => embed.split('\n').slice(1, -2).join('\n');

describe('parseViewWidth', () => {
  it('is null (fill the column) unless a number, and clamps', () => {
    expect(parseViewWidth(undefined)).toBeNull();
    expect(parseViewWidth('900')).toBeNull();
    expect(parseViewWidth('full')).toBeNull();
    expect(parseViewWidth(Number.NaN)).toBeNull();
    expect(parseViewWidth(10)).toBe(OBJECT_VIEW_MIN_WIDTH);
    expect(parseViewWidth(1e9)).toBe(OBJECT_VIEW_MAX_WIDTH);
    expect(parseViewWidth(1200.6)).toBe(1201);
  });
});

describe('spec round-trip', () => {
  const base = { typeId: 'task', layout: 'kanban' as const, sortColumn: null, sortDir: 'asc' as const, columns: null };

  it('writes a width and reads it back', () => {
    const embed = buildViewEmbed({ ...base, width: 1400, height: 520 });
    expect(embed).toContain('"width": 1400');
    const spec = parseObjectViewSpec(fenceBody(embed));
    expect(spec.width).toBe(1400);
    expect(spec.height).toBe(520);
  });
  it('omits it when unset, so existing embeds are unchanged', () => {
    expect(buildViewEmbed({ ...base, width: null })).toBe(buildViewEmbed(base));
    expect(buildViewEmbed(base)).not.toContain('width');
    expect(parseObjectViewSpec(fenceBody(buildViewEmbed(base))).width).toBeNull();
  });
  it('keeps a stored width wider than any pane — the clamp is the renderer\'s', () => {
    expect(parseObjectViewSpec('{"typeId":"t","layout":"timeline","width":3000}').width).toBe(3000);
  });
});

describe('setViewWidthInSpec', () => {
  it('adds to a one-line spec, keeping it on one line', () => {
    expect(setViewWidthInSpec('{"typeId":"t","layout":"kanban"}', 1100)).toBe('{"typeId":"t","layout":"kanban","width":1100}');
  });
  it('adds to a pretty-printed spec as one line', () => {
    expect(setViewWidthInSpec('{\n  "typeId": "t",\n  "layout": "kanban"\n}', 1100))
      .toBe('{\n  "typeId": "t",\n  "layout": "kanban",\n  "width": 1100\n}');
  });
  it('replaces and removes in place, leaving height alone', () => {
    expect(setViewWidthInSpec('{"typeId": "t", "width": 900, "height": 500}', 1200)).toBe('{"typeId": "t", "width": 1200, "height": 500}');
    expect(setViewWidthInSpec('{"typeId": "t", "width": 900, "height": 500}', null)).toBe('{"typeId": "t", "height": 500}');
    expect(setViewWidthInSpec('{"typeId": "t", "height": 500, "width": 900}', null)).toBe('{"typeId": "t", "height": 500}');
  });
  it('a reset with no width written changes nothing', () => {
    expect(setViewWidthInSpec('{"typeId":"t"}', null)).toBe('{"typeId":"t"}');
  });
  it('refuses a body that is not a JSON object', () => {
    expect(setViewWidthInSpec('[1]', 900)).toBeNull();
  });
});

describe('applyObjectViewWidth', () => {
  const note = '# N\n\n```object-view\n{"typeId":"task","layout":"kanban"}\n```\n\nafter\n';
  it('rewrites the fence that opens on the line', () => {
    expect(applyObjectViewWidth(note, 3, 1300)).toBe(note.replace('"layout":"kanban"}', '"layout":"kanban","width":1300}'));
  });
  it('composes with a height on the same fence', () => {
    const both = applyObjectViewHeight(applyObjectViewWidth(note, 3, 1300)!, 3, 600)!;
    expect(parseObjectViewSpec(both.split('\n')[3]!)).toMatchObject({ width: 1300, height: 600 });
  });
  it('writes nothing when that line is not an object-view fence', () => {
    expect(applyObjectViewWidth(note, 1, 900)).toBeNull();
  });
  it('keeps a CRLF note CRLF', () => {
    const crlf = note.replace(/\n/g, '\r\n');
    expect(applyObjectViewWidth(crlf, 3, 900)).toBe(crlf.replace('"layout":"kanban"}', '"layout":"kanban","width":900}'));
  });
});
