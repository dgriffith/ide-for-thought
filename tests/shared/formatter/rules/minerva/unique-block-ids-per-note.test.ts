import { describe, it, expect } from 'vitest';
import '../../../../../src/shared/formatter/rules/minerva/unique-block-ids-per-note';
import { formatContent } from '../../../../../src/shared/formatter/engine';

const enabled = {
  enabled: { 'unique-block-ids-per-note': true },
  configs: {},
};

describe('unique-block-ids-per-note (#161)', () => {
  it('suffixes a single duplicate', () => {
    const src = 'First paragraph ^note\n\nSecond paragraph ^note\n';
    const out = formatContent(src, enabled);
    expect(out).toContain(' ^note\n');
    expect(out).toContain(' ^note-2\n');
  });

  it('suffixes multiple duplicates sequentially', () => {
    const src = 'p1 ^x\n\np2 ^x\n\np3 ^x\n\np4 ^x\n';
    const out = formatContent(src, enabled);
    expect(out).toMatch(/p1 \^x\n/);
    expect(out).toMatch(/p2 \^x-2\n/);
    expect(out).toMatch(/p3 \^x-3\n/);
    expect(out).toMatch(/p4 \^x-4\n/);
  });

  it('leaves unique block-ids alone', () => {
    const src = 'p1 ^a\n\np2 ^b\n\np3 ^c\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('does not collide with an id that already uses the suffix', () => {
    const src = 'a ^x\n\nb ^x-2\n\nc ^x\n';
    const out = formatContent(src, enabled);
    // The first ^x stays. ^x-2 stays (unique). The second ^x must become
    // something other than x-2 (already taken) — so x-3.
    expect(out).toContain(' ^x\n');
    expect(out).toContain(' ^x-2\n');
    expect(out).toContain(' ^x-3\n');
  });

  it('does not rename block-ids inside a code fence', () => {
    const src = '```\nsome code ^x\n^x again\n```\n\nreal ^x\n';
    expect(formatContent(src, enabled)).toBe(src);
  });

  it('is idempotent', () => {
    const once = formatContent('p ^note\n\np ^note\n', enabled);
    expect(formatContent(once, enabled)).toBe(once);
  });
});
