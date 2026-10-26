/**
 * Whether a change writes or turns off the thoughtbase guide (#2837): the
 * root `thoughtbase.md` exactly, in any case, decided from the path the
 * change results in.
 */
import { describe, it, expect } from 'vitest';
import { guideEffectOfMove, guideEffectOfPayload, guideEffectOfPayloads, isThoughtbaseGuidePath } from '../../src/shared/thoughtbase-guide';

describe('isThoughtbaseGuidePath (#2837)', () => {
  it.each(['thoughtbase.md', 'Thoughtbase.md', 'THOUGHTBASE.MD', './thoughtbase.md', 'notes/../thoughtbase.md', '/thoughtbase.md', 'notes\\..\\thoughtbase.md'])('%s is the guide', (p) => {
    expect(isThoughtbaseGuidePath(p)).toBe(true);
  });
  it.each(['notes/thoughtbase.md', 'thoughtbase.md.bak', 'thoughtbase.markdown', 'my-thoughtbase.md', '../thoughtbase.md', '', 'notes/..'])('%s is not', (p) => {
    expect(isThoughtbaseGuidePath(p)).toBe(false);
  });
  it('is false for something that isn\'t a path', () => {
    expect(isThoughtbaseGuidePath(undefined)).toBe(false);
    expect(isThoughtbaseGuidePath(null)).toBe(false);
  });
});

describe('what a change does to the guide (#2837)', () => {
  it('a move or rename into its place writes it; one away turns it off; neither is nothing', () => {
    expect(guideEffectOfMove('notes/plan.md', 'thoughtbase.md')).toBe('writes');
    expect(guideEffectOfMove('notes/plan.md', 'Thoughtbase.md')).toBe('writes');
    expect(guideEffectOfMove('thoughtbase.md', 'archive/thoughtbase.md')).toBe('removes');
    expect(guideEffectOfMove('thoughtbase.md', 'Thoughtbase.md')).toBeNull();
    expect(guideEffectOfMove('a.md', 'b.md')).toBeNull();
  });

  it('reads each payload kind by the path it results in', () => {
    expect(guideEffectOfPayload({ kind: 'note', relativePath: 'thoughtbase.md' })).toBe('writes');
    expect(guideEffectOfPayload({ kind: 'note-rewrite', path: 'thoughtbase.md' })).toBe('writes');
    expect(guideEffectOfPayload({ kind: 'note-delete', path: 'thoughtbase.md' })).toBe('removes');
    expect(guideEffectOfPayload({ kind: 'note-refactor', fromPath: 'x.md', toPath: 'thoughtbase.md' })).toBe('writes');
    expect(guideEffectOfPayload({ kind: 'note', relativePath: 'notes/thoughtbase.md' })).toBeNull();
    expect(guideEffectOfPayload({ kind: 'graph-triples' })).toBeNull();
    expect(guideEffectOfPayloads([{ kind: 'note-delete', path: 'thoughtbase.md' }, { kind: 'note', relativePath: 'thoughtbase.md' }])).toBe('writes');
    expect(guideEffectOfPayloads([{ kind: 'note', relativePath: 'a.md' }])).toBeNull();
  });
});
