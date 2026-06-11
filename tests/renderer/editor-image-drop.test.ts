import { describe, it, expect } from 'vitest';
import {
  hasImageFiles,
  imageFilesFromTransfer,
  imageFilesFromClipboard,
} from '../../src/renderer/lib/editor/image-drop';

// Lightweight stand-ins for the DOM transfer surfaces — the helpers only touch
// `kind` / `type` / `getAsFile()` / iteration, so plain arrays cast to the DOM
// types exercise the real logic without needing a full jsdom DataTransfer.
const img = (name = 'shot.png', type = 'image/png') =>
  new File(['x'], name, { type });

function transfer(opts: { items?: unknown[]; files?: File[] }): DataTransfer {
  return { items: opts.items ?? [], files: opts.files ?? [] } as unknown as DataTransfer;
}

function fileItem(file: File) {
  return { kind: 'file', type: file.type, getAsFile: () => file };
}

describe('hasImageFiles', () => {
  it('detects an image via the items surface', () => {
    const dt = transfer({ items: [fileItem(img())] });
    expect(hasImageFiles(dt)).toBe(true);
  });

  it('detects an image via the files fallback', () => {
    const dt = transfer({ files: [img()] });
    expect(hasImageFiles(dt)).toBe(true);
  });

  it('is false for a text drag (string item, no image file)', () => {
    const dt = transfer({ items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] });
    expect(hasImageFiles(dt)).toBe(false);
  });

  it('is false for a non-image file', () => {
    const dt = transfer({ files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] });
    expect(hasImageFiles(dt)).toBe(false);
  });

  it('is false for an empty transfer', () => {
    expect(hasImageFiles(transfer({}))).toBe(false);
  });
});

describe('imageFilesFromTransfer', () => {
  it('returns only the image files from a mixed drop', () => {
    const png = img('a.png');
    const files = [png, new File(['x'], 'b.txt', { type: 'text/plain' })];
    expect(imageFilesFromTransfer(transfer({ files }))).toEqual([png]);
  });
});

describe('imageFilesFromClipboard', () => {
  it('collects image files, skipping string items and null getAsFile()', () => {
    const png = img('paste.png');
    const items = [
      { kind: 'string', type: 'text/html', getAsFile: () => null },
      fileItem(png),
      { kind: 'file', type: 'image/gif', getAsFile: () => null }, // file item but no blob
    ] as unknown as DataTransferItemList;
    expect(imageFilesFromClipboard(items)).toEqual([png]);
  });

  it('returns empty when there are no image items', () => {
    const items = [
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
    ] as unknown as DataTransferItemList;
    expect(imageFilesFromClipboard(items)).toEqual([]);
  });
});
