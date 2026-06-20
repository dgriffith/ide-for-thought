import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/minerva/strip-orphaned-block-ids';
import { formatContent } from '../../../../../src/shared/formatter/engine';
import type { FormatContext } from '../../../../../src/shared/formatter/types';

const enabled = { enabled: { 'strip-orphaned-block-ids': true }, configs: {} };

/** ctx where the listed `^id` anchors have incoming links and all else are orphans. */
function ctx(linked: string[]): FormatContext {
  return {
    notePath: 'notes/foo.md',
    incomingAnchorLinkCount: (_target, slug) => (linked.includes(slug) ? 1 : 0),
  };
}

describe('strip-orphaned-block-ids (#215)', () => {
  it('strips a block-id nothing links to', () => {
    expect(formatContent('A paragraph ^orphan\n', enabled, ctx([]))).toBe('A paragraph\n');
  });

  it('keeps a block-id that has incoming links', () => {
    const src = 'A paragraph ^kept\n';
    expect(formatContent(src, enabled, ctx(['^kept']))).toBe(src);
  });

  it('strips only the orphans, keeping the linked ones', () => {
    expect(formatContent('one ^a\n\ntwo ^b\n', enabled, ctx(['^b']))).toBe('one\n\ntwo ^b\n');
  });

  it('no-ops without cross-note context (paste / no project)', () => {
    const src = 'A paragraph ^x\n';
    expect(formatContent(src, enabled)).toBe(src);                       // no ctx at all
    expect(formatContent(src, enabled, { notePath: 'notes/foo.md' })).toBe(src); // ctx, no link fn
  });

  it('ignores `^id`-looking text inside fenced code', () => {
    const src = '```\ncode ^notid\n```\n';
    expect(formatContent(src, enabled, ctx([]))).toBe(src);
  });

  it('is off by default (not in the house style)', () => {
    expect(formatContent('p ^orphan\n', { enabled: {}, configs: {} }, ctx([]))).toBe('p ^orphan\n');
  });
});
