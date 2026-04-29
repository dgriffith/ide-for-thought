import { describe, it, expect } from 'vitest';
import {
  buildLinkResolverContext,
  resolveWikiLink,
  rewriteWikiLinksInContent,
} from '../../../src/main/publish/link-resolver';
import type { ExportPlan, LinkPolicy } from '../../../src/main/publish/types';

function mkPlan(linkPolicy: LinkPolicy): ExportPlan {
  return {
    inputKind: 'project',
    inputs: [
      {
        relativePath: 'notes/foo.md',
        kind: 'note',
        content: '',
        frontmatter: {},
        title: 'Foo Title',
      },
      {
        relativePath: 'notes/bar.md',
        kind: 'note',
        content: '',
        frontmatter: {},
        title: 'Bar Title',
      },
    ],
    excluded: [],
    linkPolicy,
    assetPolicy: 'keep-relative',
  };
}

describe('resolveWikiLink — per linkPolicy', () => {
  it('drop: collapses to the display text, or title, or raw target', () => {
    const ctx = buildLinkResolverContext(mkPlan('drop'));
    expect(resolveWikiLink('notes/foo', null, 'custom display', ctx)).toBe('custom display');
    expect(resolveWikiLink('notes/foo', null, null, ctx)).toBe('Foo Title');
    expect(resolveWikiLink('notes/never-heard-of', null, null, ctx)).toBe('notes/never-heard-of');
  });

  it('inline-title: replaces with the target title, even when display text is provided', () => {
    const ctx = buildLinkResolverContext(mkPlan('inline-title'));
    expect(resolveWikiLink('notes/foo', null, 'display', ctx)).toBe('Foo Title');
  });

  it('follow-to-file: rewrites to a relative md link when the target is in the plan', () => {
    const ctx = buildLinkResolverContext(mkPlan('follow-to-file'));
    expect(resolveWikiLink('notes/foo', null, null, ctx)).toBe('[Foo Title](notes/foo.md)');
    expect(resolveWikiLink('notes/foo', 'main', 'display', ctx)).toBe('[display](notes/foo.md#main)');
  });

  it('follow-to-file: falls through to inline-title when the target isn’t in the plan', () => {
    const ctx = buildLinkResolverContext(mkPlan('follow-to-file'));
    expect(resolveWikiLink('notes/missing', null, 'display', ctx)).toBe('display');
  });
});

describe('rewriteWikiLinksInContent', () => {
  const ctx = buildLinkResolverContext(mkPlan('follow-to-file'));

  it('rewrites plain, display-text, and typed links', () => {
    const out = rewriteWikiLinksInContent(
      'See [[notes/foo]] and [[notes/bar|over here]] and [[references::notes/foo]].',
      ctx,
    );
    expect(out).toBe(
      'See [Foo Title](notes/foo.md) and [over here](notes/bar.md) and [Foo Title](notes/foo.md).',
    );
  });

  it('preserves anchors in follow-to-file rewrites', () => {
    const out = rewriteWikiLinksInContent('Jump to [[notes/foo#section]].', ctx);
    expect(out).toBe('Jump to [Foo Title](notes/foo.md#section).');
  });

  it('leaves [[cite::…]] and [[quote::…]] untouched', () => {
    const input = 'See [[cite::smith-2023]] and [[quote::p42]].';
    expect(rewriteWikiLinksInContent(input, ctx)).toBe(input);
  });

  it('drops the link but preserves the display text when the target is missing and policy is follow-to-file', () => {
    const out = rewriteWikiLinksInContent('See [[notes/deleted|the old one]].', ctx);
    expect(out).toBe('See the old one.');
  });
});
