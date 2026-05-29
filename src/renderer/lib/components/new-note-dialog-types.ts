/**
 * Types shared between NewNoteDialog.svelte and its host App.svelte
 * (#475). Lives outside the .svelte file because Svelte 5's instance
 * script doesn't expose `export type` to other modules — only the
 * module script does, and adding a `<script context="module">` block
 * just for two types is heavier than a sibling file.
 */

export type NoteExt = '.md' | '.ttl' | '.csv' | '.py';

export interface NewNoteResult {
  name: string;
  ext: NoteExt;
  /** Filename of the chosen template (`.md` types only), or null
   *  for a blank file. */
  templateFilename: string | null;
}
