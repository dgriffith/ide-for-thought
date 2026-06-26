/**
 * `.apkg` Anki package writer (#853).
 *
 * Builds a package and reads it back: unzip → open the `collection.anki2`
 * SQLite with sql.js → assert the notes carry the caller's guids, the fields
 * split front/back, and the decks were created. This validates the package is
 * well-formed without needing Anki itself.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { buildApkg, type AnkiCard } from '../../../src/main/publish/exporters/anki/apkg';

const CARDS: AnkiCard[] = [
  { guid: 'g-one', deck: 'Spanish::Verbs', front: '<p>hola</p>', back: '<p>hello</p>' },
  { guid: 'g-two', deck: 'Spanish::Verbs', front: '<p>adios</p>', back: '<p>goodbye</p>' },
  { guid: 'g-three', deck: 'Geography', front: '<p>capital of France?</p>', back: '<p>Paris</p>' },
];

/** Open the collection.anki2 inside an .apkg and return a queryable handle. */
async function openCollection(apkg: Uint8Array) {
  const zip = await JSZip.loadAsync(apkg);
  expect(zip.file('collection.anki2')).not.toBeNull();
  expect(zip.file('media')).not.toBeNull();
  const dbBytes = await zip.file('collection.anki2')!.async('uint8array');

  const initSqlJs = (await import('sql.js')).default;
  const require = createRequire(import.meta.url);
  const wasm = path.join(path.dirname(require.resolve('sql.js')), 'sql-wasm.wasm');
  const SQL = await initSqlJs({ wasmBinary: readFileSync(wasm) }) as unknown as {
    Database: new (data: Uint8Array) => { exec(sql: string): { columns: string[]; values: unknown[][] }[]; close(): void };
  };
  return new SQL.Database(dbBytes);
}

describe('buildApkg', () => {
  it('produces a zip with a SQLite collection.anki2 and a media manifest', async () => {
    const apkg = await buildApkg(CARDS, 1_700_000_000_000);
    expect(apkg.length).toBeGreaterThan(0);
    const zip = await JSZip.loadAsync(apkg);
    const db = await zip.file('collection.anki2')!.async('uint8array');
    expect(Buffer.from(db.slice(0, 15)).toString()).toBe('SQLite format 3');
    expect(await zip.file('media')!.async('string')).toBe('{}');
  });

  it('writes one note per card, each carrying the caller guid + split fields', async () => {
    const db = await openCollection(await buildApkg(CARDS, 1_700_000_000_000));
    const rows = db.exec('SELECT guid, flds FROM notes ORDER BY guid')[0];
    const guids = rows.values.map((r) => r[0]);
    expect(guids).toEqual(['g-one', 'g-three', 'g-two']);
    // flds joins front + back with the 0x1f unit separator.
    const oneFlds = rows.values.find((r) => r[0] === 'g-one')![1] as string;
    expect(oneFlds).toBe('<p>hola</p>\x1f<p>hello</p>');
    db.close();
  });

  it('creates a card per note and the decks from distinct deck names', async () => {
    const db = await openCollection(await buildApkg(CARDS, 1_700_000_000_000));
    const cardCount = db.exec('SELECT COUNT(*) FROM cards')[0].values[0][0];
    expect(cardCount).toBe(3);
    // The col.decks JSON carries Default + the two distinct decks.
    const decksJson = db.exec('SELECT decks FROM col')[0].values[0][0] as string;
    const decks = Object.values(JSON.parse(decksJson)).map((d) => (d as { name: string }).name);
    expect(decks).toContain('Spanish::Verbs');
    expect(decks).toContain('Geography');
    expect(decks).toContain('Default');
    db.close();
  });

  it('is deterministic for fixed cards + timestamp (stable re-export)', async () => {
    const a = await buildApkg(CARDS, 1_700_000_000_000);
    const b = await buildApkg(CARDS, 1_700_000_000_000);
    // The SQLite bytes are identical → byte-identical decks for unchanged input.
    const dbA = await (await JSZip.loadAsync(a)).file('collection.anki2')!.async('uint8array');
    const dbB = await (await JSZip.loadAsync(b)).file('collection.anki2')!.async('uint8array');
    expect(Buffer.from(dbA).equals(Buffer.from(dbB))).toBe(true);
  });

  it('yields a valid (empty) package for zero cards', async () => {
    const apkg = await buildApkg([], 1_700_000_000_000);
    const db = await openCollection(apkg);
    expect(db.exec('SELECT COUNT(*) FROM notes')[0].values[0][0]).toBe(0);
    db.close();
  });
});
