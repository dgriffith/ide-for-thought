/**
 * Anki deck exporter (#853) — end to end over a real plan: build cards across
 * the scope, write missing ids back to the note, and emit a `.apkg`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import JSZip from 'jszip';
import { createRequire } from 'node:module';
import { ankiDeckExporter } from '../../../src/main/publish/exporters/anki/anki-deck';
import { resolvePlan, runExporter } from '../../../src/main/publish/pipeline';

let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'anki-test-')); });
afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

async function noteCount(apkg: Uint8Array): Promise<number> {
  const zip = await JSZip.loadAsync(apkg);
  const db = await zip.file('collection.anki2')!.async('uint8array');
  const initSqlJs = (await import('sql.js')).default;
  const require = createRequire(import.meta.url);
  const wasm = path.join(path.dirname(require.resolve('sql.js')), 'sql-wasm.wasm');
  const SQL = await initSqlJs({ wasmBinary: fs.readFileSync(wasm) }) as unknown as {
    Database: new (d: Uint8Array) => { exec(s: string): { values: unknown[][] }[]; close(): void };
  };
  const handle = new SQL.Database(db);
  const n = handle.exec('SELECT COUNT(*) FROM notes')[0].values[0][0] as number;
  handle.close();
  return n;
}

describe('ankiDeckExporter', () => {
  it('exports cards to a .apkg and writes missing ^ids back into the note', async () => {
    await fsp.writeFile(path.join(root, 'es.md'),
      '# Spanish\n\n> [!card] Verbs\n> hola\n> ---\n> hello\n\n> [!card] Verbs ^keep1\n> adios\n> ---\n> goodbye\n');
    const plan = await resolvePlan(root, { kind: 'single-note', relativePath: 'es.md' });
    const out = await runExporter(ankiDeckExporter, plan);

    // One .apkg with two notes.
    expect(out.files).toHaveLength(1);
    expect(out.files[0].path).toBe('es.apkg');
    expect(await noteCount(out.files[0].contents as Uint8Array)).toBe(2);
    expect(out.summary).toContain('2 cards');
    expect(out.summary).toContain('Verbs');

    // The id-less card gained an ^id on disk; the existing one is untouched.
    const after = await fsp.readFile(path.join(root, 'es.md'), 'utf8');
    expect(after).toMatch(/> \[!card\] Verbs \^[\w-]+\n> hola/);
    expect(after).toContain('> [!card] Verbs ^keep1\n> adios');
  });

  it('re-exporting after the write-back assigns no new ids (idempotent)', async () => {
    await fsp.writeFile(path.join(root, 'n.md'), '> [!card]\n> Q\n> ---\n> A\n');
    await runExporter(ankiDeckExporter, await resolvePlan(root, { kind: 'single-note', relativePath: 'n.md' }));
    const afterFirst = await fsp.readFile(path.join(root, 'n.md'), 'utf8');
    await runExporter(ankiDeckExporter, await resolvePlan(root, { kind: 'single-note', relativePath: 'n.md' }));
    const afterSecond = await fsp.readFile(path.join(root, 'n.md'), 'utf8');
    expect(afterSecond).toBe(afterFirst); // no new ids, byte-for-byte stable
  });

  it('reports a clean message and writes nothing when the scope has no cards', async () => {
    await fsp.writeFile(path.join(root, 'plain.md'), '# Just a note\n\nNo cards here.\n');
    const out = await runExporter(ankiDeckExporter, await resolvePlan(root, { kind: 'single-note', relativePath: 'plain.md' }));
    expect(out.files).toHaveLength(0);
    expect(out.summary.toLowerCase()).toContain('no flashcards');
  });

  it('accepts note/folder/tree/project scopes, not source', () => {
    expect(ankiDeckExporter.accepts({ kind: 'single-note', relativePath: 'x.md' })).toBe(true);
    expect(ankiDeckExporter.accepts({ kind: 'project' })).toBe(true);
    expect(ankiDeckExporter.accepts({ kind: 'source', sourceId: 's' } as never)).toBe(false);
  });
});
