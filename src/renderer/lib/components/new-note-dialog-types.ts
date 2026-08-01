/**
 * Types shared between NewNoteDialog.svelte and its host App.svelte
 * (#475). Lives outside the .svelte file because Svelte 5's instance
 * script doesn't expose `export type` to other modules — only the
 * module script does, and adding a `<script context="module">` block
 * just for two types is heavier than a sibling file.
 */

import type { TypeInfo } from '../../../shared/objects/type-def';

export type NoteExt = '.md' | '.ttl' | '.csv' | '.py';

export interface NewNoteResult {
  name: string;
  ext: NoteExt;
  /** Filename of the chosen template (`.md` types only), or null
   *  for a blank file. */
  templateFilename: string | null;
  /** The domain type the note was created *as* (#1064), or null for a plain
   *  note. When set, `ext` is always `.md` and `templateFilename` is null —
   *  the type's own template + property scaffold apply instead. */
  type?: TypeInfo | null;
}
