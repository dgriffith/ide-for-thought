/**
 * Folder renames keep folder-scoped views pointing at them (#2535).
 */
import { describe, it, expect } from 'vitest';
import { movedFolder, rewriteViewFolders } from '../../../src/shared/objects/view-folder-rename';

const note = (spec: string, fence = '```') => `# Plan\n\nBefore.\n\n${fence}object-view\n${spec}\n${fence}\n\nAfter.\n`;

describe('movedFolder', () => {
  it('maps the folder itself and anything under it', () => {
    expect(movedFolder('trip/prague', 'trip/prague', 'travel/prague')).toBe('travel/prague');
    expect(movedFolder('trip/prague/old town', 'trip', 'travel/2026')).toBe('travel/2026/prague/old town');
  });
  it('leaves a sibling with a shared prefix, and unrelated folders, alone', () => {
    expect(movedFolder('trip/prague-old', 'trip/prague', 'x')).toBeNull();
    expect(movedFolder('reading', 'trip', 'x')).toBeNull();
  });
  it('tolerates trailing slashes', () => {
    expect(movedFolder('trip/prague/', 'trip/', 'travel/')).toBe('travel/prague');
  });
});

describe('rewriteViewFolders', () => {
  it('renames: rewrites only the folder value, keeping the spec as written', () => {
    const before = note('{"typeId":"place", "layout":"map",  "folder": "trip/prague", "filters":[{"property":"city","values":["Prague"]}]}');
    expect(rewriteViewFolders(before, 'trip/prague', 'travel/prague')).toBe(
      note('{"typeId":"place", "layout":"map",  "folder": "travel/prague", "filters":[{"property":"city","values":["Prague"]}]}'));
  });

  it('moves a parent: a nested folder follows', () => {
    const before = note('{"typeId":"place","folder":"trip/prague/old town"}');
    expect(rewriteViewFolders(before, 'trip', 'archive/trip')).toBe(note('{"typeId":"place","folder":"archive/trip/prague/old town"}'));
  });

  it('handles a pretty-printed spec and a ~~~ fence', () => {
    const spec = '{\n  "typeId": "place",\n  "folder": "trip/prague"\n}';
    expect(rewriteViewFolders(note(spec, '~~~'), 'trip/prague', 'p')).toBe(note(spec.replace('trip/prague', 'p'), '~~~'));
  });

  it('leaves a sibling sharing a prefix, an unscoped view and other fences alone (same string)', () => {
    const sibling = note('{"typeId":"place","folder":"trip/prague-old"}');
    expect(rewriteViewFolders(sibling, 'trip/prague', 'x')).toBe(sibling);
    const unscoped = note('{"typeId":"place"}');
    expect(rewriteViewFolders(unscoped, 'trip/prague', 'x')).toBe(unscoped);
    const json = '```json\n{"folder":"trip/prague"}\n```\n';
    expect(rewriteViewFolders(json, 'trip/prague', 'x')).toBe(json);
  });

  it('a filter on a property named "folder" isn\'t mistaken for the scope', () => {
    const before = note('{"typeId":"doc","folder":"trip","filters":[{"property":"folder","values":["trip"]}]}');
    expect(rewriteViewFolders(before, 'trip', 'travel')).toBe(note('{"typeId":"doc","folder":"travel","filters":[{"property":"folder","values":["trip"]}]}'));
  });

  it('rewrites every view in a note, and escapes the new path', () => {
    const before = `${note('{"typeId":"a","folder":"trip"}')}\n${note('{"typeId":"b","folder":"trip/x"}')}`;
    const after = rewriteViewFolders(before, 'trip', 'my "trip"');
    expect(after).toContain('"folder":"my \\"trip\\""');
    expect(after).toContain('"folder":"my \\"trip\\"/x"');
  });

  it('leaves malformed JSON and an object-view inside a longer fence alone', () => {
    const broken = note('{"typeId":"place","folder":"trip"');
    expect(rewriteViewFolders(broken, 'trip', 'x')).toBe(broken);
    const quoted = '````md\n```object-view\n{"typeId":"a","folder":"trip"}\n```\n````\n';
    expect(rewriteViewFolders(quoted, 'trip', 'x')).toBe(quoted);
  });
});
