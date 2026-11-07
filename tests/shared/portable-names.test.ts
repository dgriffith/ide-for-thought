import { describe, it, expect } from 'vitest';
import { nonPortablePath, nonPortableSegment, PathCollisions } from '../../src/shared/portable-names';

describe('portable names (#2983)', () => {
  it('refuses Windows device names, with or without an extension, in any case', () => {
    for (const name of ['CON', 'con', 'Prn', 'aux.md', 'NUL.txt', 'nul.tar.gz', 'COM1', 'com9.json', 'LPT3', 'lpt1.js', 'COM¹']) {
      expect(nonPortableSegment(name), name).toMatch(/device name/);
    }
  });

  it('allows names that merely start like one', () => {
    for (const name of ['console.md', 'nullable.ts', 'auxiliary', 'com10', 'lpt', 'company.json', 'connection.md']) {
      expect(nonPortableSegment(name), name).toBeNull();
    }
  });

  it('refuses a trailing dot or space, and a colon', () => {
    expect(nonPortableSegment('plugin.json.')).toMatch(/ends in a dot or a space/);
    expect(nonPortableSegment('notes ')).toMatch(/ends in a dot or a space/);
    expect(nonPortableSegment('file.md:hidden')).toMatch(/alternate data stream/);
  });

  it('checks every segment of a path, and a trailing folder slash is fine', () => {
    expect(nonPortablePath('types/sample.md')).toBeNull();
    expect(nonPortablePath('assets/')).toBeNull();
    expect(nonPortablePath('docs/con/readme.md')).toMatch(/"con" is a device name/);
    expect(nonPortablePath('skills./x.md')).toMatch(/ends in a dot/);
  });

  it('PathCollisions refuses a path, or a folder on the way, that differs only in case or Unicode form', () => {
    const c = new PathCollisions();
    expect(c.claim('types/')).toBeNull();
    expect(c.claim('types/a.md')).toBeNull();
    expect(c.claim('types/a.md')).toBeNull(); // the same name again is not a collision
    expect(c.claim('types/A.md')).toMatch(/"types\/A\.md" and "types\/a\.md" differ only in case/);
    expect(c.claim('Types/b.md')).toMatch(/"Types" and "types"/);
    expect(c.claim('café.md')).toBeNull();
    expect(c.claim('café.md')).toMatch(/differ only in case or Unicode form/);
  });
});
