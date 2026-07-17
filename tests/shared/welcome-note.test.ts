import { describe, it, expect } from 'vitest';
import { parse as parseYAML } from 'yaml';
import { WELCOME_NOTE_PATH, welcomeNoteContent } from '../../src/shared/welcome-note';

describe('welcomeNoteContent', () => {
  it('lands at Welcome.md', () => {
    expect(WELCOME_NOTE_PATH).toBe('Welcome.md');
  });

  it('carries a parseable entrypoint tag so the note auto-opens', () => {
    const body = welcomeNoteContent(true);
    const fm = body.match(/^---\n([\s\S]*?)\n---/);
    expect(fm).not.toBeNull();
    const parsed = parseYAML(fm![1]!) as { tags?: string[] };
    expect(parsed.tags).toEqual(['entrypoint']);
  });

  it('uses the mac glyph on darwin and Ctrl elsewhere', () => {
    expect(welcomeNoteContent(true)).toContain('⌘N');
    expect(welcomeNoteContent(true)).not.toContain('Ctrl+N');
    expect(welcomeNoteContent(false)).toContain('Ctrl+N');
    expect(welcomeNoteContent(false)).not.toContain('⌘N');
  });

  it('greets the reader', () => {
    expect(welcomeNoteContent(true)).toContain('Welcome to your thoughtbase');
  });
});
