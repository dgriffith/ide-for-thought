/**
 * Stable per-card identity (#852) — the make-or-break of flashcards.
 *
 * The logic is small; the value is the matrix: new / unchanged / edited /
 * deleted / duplicate cards, plus byte-for-byte preservation on write-back.
 */

import { describe, it, expect } from 'vitest';
import { cardGuid, assignCardIds, findDuplicateCardIds, generateCardId } from '../../../src/shared/flashcards/guid';
import { collectCards } from '../../../src/shared/flashcards/cards';

// A deterministic id generator for assertable output.
function seq(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

describe('cardGuid', () => {
  it('is deterministic — same note + card id → same guid', () => {
    expect(cardGuid('notes/a.md', 'abc')).toBe(cardGuid('notes/a.md', 'abc'));
  });

  it('depends on both the note key and the card id', () => {
    expect(cardGuid('notes/a.md', 'abc')).not.toBe(cardGuid('notes/b.md', 'abc'));
    expect(cardGuid('notes/a.md', 'abc')).not.toBe(cardGuid('notes/a.md', 'xyz'));
  });

  it('is a non-empty short string', () => {
    const g = cardGuid('notes/a.md', 'abc');
    expect(g.length).toBeGreaterThan(0);
    expect(g.length).toBeLessThan(16);
  });
});

describe('assignCardIds', () => {
  it('appends a ^id to a card that lacks one', () => {
    const { content, assignedCount } = assignCardIds('> [!card] Deck\n> Q\n> ---\n> A', seq());
    expect(assignedCount).toBe(1);
    expect(content).toBe('> [!card] Deck ^id1\n> Q\n> ---\n> A');
  });

  it('leaves a card that already has an id untouched (idempotent)', () => {
    const doc = '> [!card] Deck ^keepme\n> Q\n> ---\n> A';
    const { content, assignedCount } = assignCardIds(doc, seq());
    expect(assignedCount).toBe(0);
    expect(content).toBe(doc); // byte-for-byte
  });

  it('running twice is a no-op the second time (write-back idempotency)', () => {
    const first = assignCardIds('> [!card]\n> Q\n> ---\n> A', seq());
    const second = assignCardIds(first.content, seq());
    expect(second.assignedCount).toBe(0);
    expect(second.content).toBe(first.content);
  });

  it('only the card line changes; all other content is preserved byte-for-byte', () => {
    const doc = '# Title\n\nsome prose with trailing spaces   \n\n> [!card]\n> Q\n> ---\n> A\n\n## Footer\n';
    const { content } = assignCardIds(doc, seq());
    const expected = '# Title\n\nsome prose with trailing spaces   \n\n> [!card] ^id1\n> Q\n> ---\n> A\n\n## Footer\n';
    expect(content).toBe(expected);
  });

  it('generated ids avoid colliding with ids already in the note', () => {
    // First card has id "id1"; the generator would also yield "id1" first, so
    // the new card must get "id2".
    const doc = '> [!card] ^id1\n> Q1\n> ---\n> A1\n\n> [!card]\n> Q2\n> ---\n> A2';
    const { content } = assignCardIds(doc, seq());
    const ids = collectCards(content, 'n.md').cards.map((c) => c.id);
    expect(new Set(ids).size).toBe(2); // no collision
    expect(ids).toContain('id1');
  });

  it('assigns ids only to cards, not to other callouts', () => {
    const doc = '> [!note] heads up\n> not a card\n\n> [!card]\n> Q\n> ---\n> A';
    const { content } = assignCardIds(doc, seq());
    expect(content).toContain('> [!note] heads up'); // unchanged
    expect(content).toContain('> [!card] ^id1');
  });
});

describe('idempotency contract (the make-or-break)', () => {
  // The note as it lives on disk after the first export (ids persisted).
  const persisted = '> [!card] Spanish ^c1\n> hola\n> ---\n> hello\n\n> [!card] Spanish ^c2\n> adios\n> ---\n> goodbye';
  const notePath = 'lang/spanish.md';

  function guidsOf(content: string): string[] {
    return collectCards(content, notePath).cards.map((c) => cardGuid(notePath, c.id!));
  }

  it('re-exporting unchanged cards yields identical guids', () => {
    expect(guidsOf(persisted)).toEqual(guidsOf(persisted));
  });

  it('editing a card\'s text preserves its guid (Anki updates, keeps history)', () => {
    const edited = persisted.replace('hello', 'hello (greeting)');
    const before = guidsOf(persisted);
    const after = guidsOf(edited);
    expect(after).toEqual(before); // text changed, guids unchanged
  });

  it('deleting a card simply stops emitting its guid', () => {
    const deleted = '> [!card] Spanish ^c1\n> hola\n> ---\n> hello';
    const guids = guidsOf(deleted);
    expect(guids).toEqual([cardGuid(notePath, 'c1')]);
    expect(guids).not.toContain(cardGuid(notePath, 'c2'));
  });
});

describe('findDuplicateCardIds', () => {
  it('flags an id used by more than one card in a note', () => {
    const doc = '> [!card] ^dup\n> Q1\n> ---\n> A1\n\n> [!card] ^dup\n> Q2\n> ---\n> A2';
    const { cards } = collectCards(doc, 'n.md');
    expect(findDuplicateCardIds(cards)).toEqual(['dup']);
  });

  it('returns nothing when ids are unique', () => {
    const doc = '> [!card] ^a\n> Q1\n> ---\n> A1\n\n> [!card] ^b\n> Q2\n> ---\n> A2';
    const { cards } = collectCards(doc, 'n.md');
    expect(findDuplicateCardIds(cards)).toEqual([]);
  });
});

describe('generateCardId', () => {
  it('produces distinct 8-char hex ids', () => {
    const a = generateCardId();
    const b = generateCardId();
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
  });
});
