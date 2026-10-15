/**
 * Settings → Ontology (#2788): a thoughtbase's own vocabularies, imported as
 * Turtle into `.minerva/ontology/`. The work is `graph/user-ontology.ts`;
 * these handlers add the native picker and the project guard.
 *
 * Import is two steps so the user sees what a file declares — and anything
 * refused, and why — before it is saved. The picker reads the file in main
 * and holds its text; ONTOLOGY_IMPORT commits exactly that text by id, so the
 * renderer never names a path main will read.
 */
import { dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Channels } from '../../shared/channels';
import type { VocabularyStatus } from '../../shared/ontology-vocabularies';
import {
  commitVocabularyImport,
  previewVocabularyImport,
  removeVocabulary,
  syncVocabularies,
} from '../graph';
import { MAX_VOCABULARY_BYTES } from '../graph/user-ontology-check';
import { projectContext } from '../project-context-types';
import { handle } from './typed-ipc';
import { withRootPath, withRootPathOr, withRootPathWin } from './helpers';

export function registerOntology(): void {
  handle(Channels.ONTOLOGY_LIST, withRootPathOr<[], VocabularyStatus[] | Promise<VocabularyStatus[]>>([], (rootPath) =>
    syncVocabularies(projectContext(rootPath))));

  handle(Channels.ONTOLOGY_PICK_IMPORT, withRootPathWin(async (rootPath, win) => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Turtle', extensions: ['ttl'] }],
      title: 'Import a vocabulary',
      buttonLabel: 'Review',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const sourcePath = result.filePaths[0]!;
    // Checked for size before reading, so a huge pick isn't pulled into memory.
    const { size } = await fs.stat(sourcePath);
    if (size > MAX_VOCABULARY_BYTES) {
      throw new Error(`${path.basename(sourcePath)} is ${Math.ceil(size / 1024)} KB; a vocabulary may be at most ${MAX_VOCABULARY_BYTES / 1024} KB.`);
    }
    const text = await fs.readFile(sourcePath, 'utf-8');
    return previewVocabularyImport(projectContext(rootPath), path.basename(sourcePath), text);
  }));

  handle(Channels.ONTOLOGY_IMPORT, withRootPath((rootPath, id: string) =>
    commitVocabularyImport(projectContext(rootPath), id)));

  handle(Channels.ONTOLOGY_REMOVE, withRootPath((rootPath, file: string) =>
    removeVocabulary(projectContext(rootPath), file)));
}
