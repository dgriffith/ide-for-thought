/** A note's IRI back to its path (#2775). */
import { describe, it, expect } from 'vitest';
import { notePathForIri } from '../../../src/shared/objects/note-iri';

const BASE = 'https://project.minerva.dev/dave/thoughts/';
const PATHS = new Set(['people/Ada Lovelace.md', 'Glossary.ttl', 'note/inside.md']);

describe('notePathForIri', () => {
  it('decodes the segments and restores the extension', () => {
    expect(notePathForIri(`${BASE}note/people/Ada%20Lovelace`, PATHS)).toBe('people/Ada Lovelace.md');
    expect(notePathForIri(`${BASE}note/Glossary`, PATHS)).toBe('Glossary.ttl');
  });

  it('copes with a base that itself contains note/', () => {
    expect(notePathForIri('https://project.minerva.dev/dave/note/note/inside', PATHS)).toBe('note/inside.md');
    expect(notePathForIri('https://project.minerva.dev/dave/note/note/people/Ada%20Lovelace', PATHS)).toBe('people/Ada Lovelace.md');
  });

  it('is null for plain text, a missing note, or a malformed IRI', () => {
    expect(notePathForIri('Ada Lovelace', PATHS)).toBeNull();
    expect(notePathForIri(`${BASE}note/people/Nobody`, PATHS)).toBeNull();
    expect(notePathForIri(`${BASE}note/%E0%A4`, PATHS)).toBeNull();
  });
});
