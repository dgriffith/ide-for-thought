import { describe, it, expect } from 'vitest';
import { detectCompletionPhase, sourceOptions } from '../../../src/renderer/lib/editor/link-autocomplete';
import type { SourceMetadata } from '../../../src/shared/types';

function source(partial: Partial<SourceMetadata> & { sourceId: string }): SourceMetadata {
  return {
    sourceId: partial.sourceId,
    subtype: null,
    title: null,
    creators: [],
    year: null,
    publisher: null,
    doi: null,
    uri: null,
    abstract: null,
    ...partial,
  };
}

/**
 * Helper: simulate a cursor at the end of `before`. The absolute position
 * is just `before.length` since we're treating `before` as the start of doc.
 */
function phase(before: string) {
  return detectCompletionPhase(before, before.length);
}

describe('detectCompletionPhase', () => {
  it('returns none outside a wiki link', () => {
    expect(phase('plain text here').kind).toBe('none');
  });

  it('returns none when the last [[ is already closed', () => {
    expect(phase('[[foo]] then more').kind).toBe('none');
  });

  it('returns type-or-path right after [[', () => {
    const p = phase('See [[');
    expect(p.kind).toBe('type-or-path');
    if (p.kind === 'type-or-path') {
      expect(p.prefix).toBe('');
      expect(p.innerStart).toBe('See [['.length);
    }
  });

  it('returns type-or-path when typing a prefix with no :: yet', () => {
    const p = phase('[[supp');
    expect(p.kind).toBe('type-or-path');
    if (p.kind === 'type-or-path') expect(p.prefix).toBe('supp');
  });

  it('returns path after a committed type::', () => {
    const p = phase('[[supports::note');
    expect(p.kind).toBe('path');
    if (p.kind === 'path') {
      expect(p.typePrefix).toBe('supports');
      expect(p.prefix).toBe('note');
      expect(p.innerStart).toBe('[[supports::'.length);
    }
  });

  it('returns heading after # following a plain path', () => {
    const p = phase('[[notes/foo#comp');
    expect(p.kind).toBe('heading');
    if (p.kind === 'heading') {
      expect(p.targetPath).toBe('notes/foo');
      expect(p.prefix).toBe('comp');
      expect(p.innerStart).toBe('[[notes/foo#'.length);
    }
  });

  it('returns heading after # with a typed-link prefix', () => {
    const p = phase('[[supports::notes/foo#');
    expect(p.kind).toBe('heading');
    if (p.kind === 'heading') {
      expect(p.targetPath).toBe('notes/foo');
      expect(p.prefix).toBe('');
    }
  });

  it('returns block for #^ anchor', () => {
    const p = phase('[[notes/foo#^par');
    expect(p.kind).toBe('block');
    if (p.kind === 'block') {
      expect(p.targetPath).toBe('notes/foo');
      expect(p.prefix).toBe('par');
      expect(p.innerStart).toBe('[[notes/foo#^'.length);
    }
  });

  it('stops completing once the user types |', () => {
    expect(phase('[[notes/foo|disp').kind).toBe('none');
  });

  it('returns none when inner contains a newline', () => {
    expect(phase('[[first line\nsecond').kind).toBe('none');
  });

  it('surfaces the `cite` typePrefix so the source picker can kick in', () => {
    const p = phase('[[cite::toul');
    expect(p.kind).toBe('path');
    if (p.kind === 'path') {
      expect(p.typePrefix).toBe('cite');
      expect(p.prefix).toBe('toul');
      expect(p.innerStart).toBe('[[cite::'.length);
    }
  });
});

describe('sourceOptions (#109)', () => {
  it('inserts the source id when picked, not the title', () => {
    const [opt] = sourceOptions([source({
      sourceId: 'toulmin-1958',
      title: 'The Uses of Argument',
      creators: ['Stephen E. Toulmin'],
      year: '1958',
    })]);
    expect(opt.apply).toBe('toulmin-1958');
  });

  it('combines title and id in the match label so either text searches work', () => {
    const [opt] = sourceOptions([source({
      sourceId: 'toulmin-1958',
      title: 'The Uses of Argument',
      creators: ['Stephen E. Toulmin'],
      year: '1958',
    })]);
    expect(opt.label).toContain('The Uses of Argument');
    expect(opt.label).toContain('toulmin-1958');
  });

  it('formats the detail as `Creator · Year`', () => {
    const [opt] = sourceOptions([source({
      sourceId: 'x',
      creators: ['Alice Smith'],
      year: '2020',
    })]);
    expect(opt.detail).toBe('Alice Smith · 2020');
  });

  it('collapses multi-author bylines like the metadata header does', () => {
    const two = sourceOptions([source({
      sourceId: 'x',
      creators: ['Alice', 'Bob'],
      year: '2020',
    })])[0];
    expect(two.detail).toBe('Alice and Bob · 2020');

    const many = sourceOptions([source({
      sourceId: 'y',
      creators: ['Alice', 'Bob', 'Carol'],
      year: '2021',
    })])[0];
    expect(many.detail).toBe('Alice et al. · 2021');
  });

  it('falls back to the source id when title is missing', () => {
    const [opt] = sourceOptions([source({ sourceId: 'url-abcdef' })]);
    expect(opt.label).toContain('url-abcdef');
    expect(opt.apply).toBe('url-abcdef');
  });

  it('omits detail entirely when there is no byline and no year', () => {
    const [opt] = sourceOptions([source({ sourceId: 'plain' })]);
    expect(opt.detail).toBeUndefined();
  });
});
