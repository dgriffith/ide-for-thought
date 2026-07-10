/**
 * File-capability lookup (#1130) — the single source of truth for how the tree
 * lists a file's icon and how the editor host routes it. A binary must map to
 * `unsupported` so it's never read as text.
 */
import { describe, it, expect } from 'vitest';
import { fileCapability, isTextEditable, extensionOf } from '../../src/shared/file-capability';

describe('fileCapability (#1130)', () => {
  it('routes the existing editor types to markdown', () => {
    for (const p of ['note.md', 'data.csv', 'graph.ttl', 'helpers.py', 'notes/deep/x.MD']) {
      expect(fileCapability(p), p).toBe('markdown');
    }
  });

  it('routes plainly-textual types to plaintext', () => {
    for (const p of ['a.txt', 'b.log', 'c.json', 'd.yaml', 'e.css', 'f.js', 'g.html', 'h.xml', 'notes/i.TS']) {
      expect(fileCapability(p), p).toBe('plaintext');
    }
  });

  it('routes binaries / unknown types to unsupported', () => {
    for (const p of ['image.png', 'photo.JPG', 'archive.zip', 'doc.docx', 'movie.mp4', 'font.woff2', 'mystery']) {
      expect(fileCapability(p), p).toBe('unsupported');
    }
  });

  it('treats a leading-dot config file as plain text (.gitignore)', () => {
    expect(fileCapability('.gitignore')).toBe('plaintext');
    expect(fileCapability('.editorconfig')).toBe('plaintext');
  });

  it('handles the double-extension CSV schema sidecar as plain text', () => {
    expect(fileCapability('data.csv.schema.yaml')).toBe('plaintext');
  });

  it('isTextEditable is true for everything but unsupported', () => {
    expect(isTextEditable('a.md')).toBe(true);
    expect(isTextEditable('a.txt')).toBe(true);
    expect(isTextEditable('a.png')).toBe(false);
  });

  it('extensionOf lowercases and includes the dot', () => {
    expect(extensionOf('notes/Foo.MD')).toBe('.md');
    expect(extensionOf('noext')).toBe('');
    expect(extensionOf('.gitignore')).toBe('.gitignore');
  });
});
