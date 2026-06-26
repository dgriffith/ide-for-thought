/**
 * `.apkg` (Anki package) writer (#850 / #853).
 *
 * An `.apkg` is a zip of a `collection.anki2` SQLite database (Anki schema
 * version 11 — the legacy format every Anki version imports) plus a `media`
 * manifest. We build the SQLite in-memory with `sql.js` (pure-WASM, no native
 * dependency, lazy-loaded) and zip it with JSZip.
 *
 * The schema + default JSON blobs follow `genanki`'s reference layout. We emit a
 * single Basic (Front/Back) note type; each note's **guid** is the caller's
 * stable per-card guid (#852) so re-importing after an edit updates the card and
 * preserves its scheduling history instead of duplicating it.
 *
 * Text-first: no media. The `media` manifest is empty (`{}`).
 */

import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import type { SqlJsStatic } from 'sql.js';

export interface AnkiCard {
  /** Stable Anki guid (#852). */
  guid: string;
  /** Full deck name; `::` denotes Anki's deck hierarchy. */
  deck: string;
  /** Front (prompt) — HTML. */
  front: string;
  /** Back (answer) — HTML. */
  back: string;
}

// A fixed model id for the Minerva Basic note type. Stable across exports so
// Anki matches the note type on re-import.
const MODEL_ID = 1700000000001;
const MODEL_NAME = 'Basic (Minerva)';

let sqlPromise: Promise<SqlJsStatic> | null = null;

/** Lazily init sql.js, loading the wasm from the (externalized, shipped) package. */
function loadSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = (async () => {
      const initSqlJs = (await import('sql.js')).default;
      const require = createRequire(import.meta.url);
      const wasm = path.join(path.dirname(require.resolve('sql.js')), 'sql-wasm.wasm');
      return initSqlJs({ wasmBinary: readFileSync(wasm) });
    })();
  }
  return sqlPromise;
}

const SCHEMA = `
CREATE TABLE col (id INTEGER PRIMARY KEY, crt INTEGER, mod INTEGER, scm INTEGER, ver INTEGER,
  dty INTEGER, usn INTEGER, ls INTEGER, conf TEXT, models TEXT, decks TEXT, dconf TEXT, tags TEXT);
CREATE TABLE notes (id INTEGER PRIMARY KEY, guid TEXT, mid INTEGER, mod INTEGER, usn INTEGER,
  tags TEXT, flds TEXT, sfld TEXT, csum INTEGER, flags INTEGER, data TEXT);
CREATE TABLE cards (id INTEGER PRIMARY KEY, nid INTEGER, did INTEGER, ord INTEGER, mod INTEGER,
  usn INTEGER, type INTEGER, queue INTEGER, due INTEGER, ivl INTEGER, factor INTEGER, reps INTEGER,
  lapses INTEGER, left INTEGER, odue INTEGER, odid INTEGER, flags INTEGER, data TEXT);
CREATE TABLE revlog (id INTEGER PRIMARY KEY, cid INTEGER, usn INTEGER, ease INTEGER, ivl INTEGER,
  lastIvl INTEGER, factor INTEGER, time INTEGER, type INTEGER);
CREATE TABLE graves (usn INTEGER, oid INTEGER, type INTEGER);
CREATE INDEX ix_notes_usn ON notes (usn);
CREATE INDEX ix_cards_usn ON cards (usn);
CREATE INDEX ix_cards_nid ON cards (nid);
CREATE INDEX ix_cards_sched ON cards (did, queue, due);
CREATE INDEX ix_revlog_cid ON revlog (cid);
CREATE INDEX ix_revlog_usn ON revlog (usn);
CREATE INDEX ix_notes_csum ON notes (csum);
`;

function basicModel(): unknown {
  return {
    [MODEL_ID]: {
      id: MODEL_ID, name: MODEL_NAME, type: 0, mod: 0, usn: 0, sortf: 0, did: 1,
      tmpls: [{
        name: 'Card 1', ord: 0,
        qfmt: '{{Front}}',
        afmt: '{{FrontSide}}\n\n<hr id="answer">\n\n{{Back}}',
        bqfmt: '', bafmt: '', did: null, bfont: '', bsize: 0,
      }],
      flds: [
        { name: 'Front', ord: 0, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] },
        { name: 'Back', ord: 1, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] },
      ],
      css: '.card { font-family: arial; font-size: 20px; text-align: center; color: black; background-color: white; }',
      latexPre: '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n',
      latexPost: '\\end{document}',
      latexsvg: false,
      req: [[0, 'any', [0]]],
      tags: [], vers: [],
    },
  };
}

function defaultConf(): unknown {
  return {
    nextPos: 1, estTimes: true, activeDecks: [1], sortType: 'noteFld', timeLim: 0,
    sortBackwards: false, addToCur: true, curDeck: 1, newSpread: 0, dueCounts: true,
    curModel: String(MODEL_ID), collapseTime: 1200,
  };
}

function deckEntry(id: number, name: string): unknown {
  return {
    id, name, mod: 0, usn: 0, lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0],
    timeToday: [0, 0], collapsed: false, browserCollapsed: false, desc: '', dyn: 0,
    conf: 1, extendNew: 0, extendRev: 0,
  };
}

function defaultDconf(): unknown {
  return {
    1: {
      id: 1, name: 'Default', mod: 0, usn: 0, maxTaken: 60, autoplay: true, timer: 0, replayq: true,
      new: { bury: false, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 0], order: 1, perDay: 20, separate: true },
      rev: { bury: false, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, minSpace: 1, perDay: 200, hardFactor: 1.2 },
      lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
      dyn: false,
    },
  };
}

/** Anki field checksum: first 8 hex of sha1 of the first field (HTML-stripped). */
function fieldChecksum(text: string): number {
  const stripped = text.replace(/<[^>]+>/g, '');
  return parseInt(createHash('sha1').update(stripped).digest('hex').slice(0, 8), 16);
}

/**
 * Build a `.apkg` byte array from cards. Decks are created from the distinct
 * deck names (Anki rebuilds the `::` hierarchy on import). Throws only on a
 * genuine sql.js / zip failure; an empty `cards` array still yields a valid
 * (empty) package — callers decide whether that's worth writing.
 */
export async function buildApkg(cards: AnkiCard[], now = Date.now()): Promise<Uint8Array> {
  const SQL = await loadSql();
  const db = new SQL.Database();
  db.run(SCHEMA);

  // Distinct decks → stable-per-export ids (2, 3, …; 1 is Default). Anki matches
  // decks by name on import, so the numeric ids only need to be internally consistent.
  const deckIds = new Map<string, number>();
  let nextDeckId = 2;
  for (const c of cards) {
    if (!deckIds.has(c.deck)) deckIds.set(c.deck, nextDeckId++);
  }
  const decks: Record<string, unknown> = { 1: deckEntry(1, 'Default') };
  for (const [name, id] of deckIds) decks[id] = deckEntry(id, name);

  const crtSec = Math.floor(now / 1000);
  db.run(
    `INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, '{}')`,
    [
      crtSec, now, now,
      JSON.stringify(defaultConf()),
      JSON.stringify(basicModel()),
      JSON.stringify(decks),
      JSON.stringify(defaultDconf()),
    ],
  );

  const insNote = db.prepare(
    `INSERT INTO notes VALUES (?, ?, ?, ?, -1, '', ?, ?, ?, 0, '')`,
  );
  const insCard = db.prepare(
    `INSERT INTO cards VALUES (?, ?, ?, 0, ?, -1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, '')`,
  );

  cards.forEach((c, i) => {
    const noteId = now + i * 2;
    const cardId = now + i * 2 + 1;
    const flds = `${c.front}${c.back}`;
    const modSec = Math.floor(now / 1000);
    // notes: (id, guid, mid, mod, [usn=-1], [tags=''], flds, sfld, csum, [flags=0], [data=''])
    insNote.run([noteId, c.guid, MODEL_ID, modSec, flds, c.front, fieldChecksum(c.front)]);
    // cards: (id, nid, did, [ord=0], mod, [usn=-1], [type=0], [queue=0], due, …)
    insCard.run([cardId, noteId, deckIds.get(c.deck) ?? 1, modSec, i + 1]);
  });
  insNote.free();
  insCard.free();

  const anki2 = db.export();
  db.close();

  const zip = new JSZip();
  zip.file('collection.anki2', anki2);
  zip.file('media', '{}');
  return zip.generateAsync({ type: 'uint8array' });
}
