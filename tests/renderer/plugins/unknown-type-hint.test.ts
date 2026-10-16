/**
 * The Properties panel's words for a `type:` no catalog defines (#2635): name
 * the recommended plugin when the thoughtbase says which provides it, list
 * the candidates when it doesn't, and always say the note is left alone.
 */
import { describe, it, expect } from 'vitest';
import { unknownTypeHint } from '../../../src/renderer/lib/plugins/unknown-type-hint';
import type { PluginRecommendation } from '../../../src/shared/plugins/format';

const rec = (id: string, extra: Partial<PluginRecommendation> = {}): PluginRecommendation => ({ id, types: [], status: 'missing', ...extra });

describe('unknownTypeHint (#2635)', () => {
  it('names the plugin a recommendation says provides the type', () => {
    expect(unknownTypeHint('book-note', { exact: rec('reading-list', { name: 'Reading List' }), possible: [] }))
      .toBe('"book-note" comes from the Reading List plugin, which isn\'t installed. This thoughtbase recommends it. The note is left as written.');
    expect(unknownTypeHint('book-note', { exact: rec('reading-list', { status: 'disabled' }), possible: [] }))
      .toContain('reading-list plugin, installed here but turned off');
  });

  it('lists the recommendations that might, when none says', () => {
    expect(unknownTypeHint('sample', { exact: null, possible: [rec('a'), rec('b', { name: 'Bee' }), rec('c')] }))
      .toBe('No type "sample" is defined here. It may come from a plugin this thoughtbase recommends: a, Bee or c. The note is left as written.');
  });

  it('with nothing recommended, says only that it may be a plugin\'s', () => {
    expect(unknownTypeHint('sample', { exact: null, possible: [] }))
      .toBe('No type "sample" is defined here; it may come from a plugin that isn\'t installed. The note is left as written.');
  });
});
