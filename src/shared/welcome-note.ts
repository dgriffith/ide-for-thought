/**
 * The welcoming default note offered when someone declines the onboarding
 * modal on an empty thoughtbase. Onboarding is the primary greeting —
 * this note is the fallback so a user who dismisses the modal lands on real
 * prose instead of a bare "Press ⌘N to create a new note" panel. It is never
 * created when the user engages onboarding.
 *
 * Pure + Electron-free so both the renderer (which writes it) and tests can
 * import it.
 */

/** Relative path of the welcome note. */
export const WELCOME_NOTE_PATH = 'Welcome.md';

/**
 * Build the welcome note body. `isMac` picks the platform-correct shortcut
 * glyph for the inline "new note" hint. The block-sequence `tags:` matches
 * what the app itself writes (via YAML.stringify), so the indexer parses it
 * reliably; the `entrypoint` tag makes this the thoughtbase's designated
 * starting surface, which the renderer re-opens on later empty-editor loads.
 */
export function welcomeNoteContent(isMac: boolean): string {
  const newNote = isMac ? '⌘N' : 'Ctrl+N';
  return `---
tags:
  - entrypoint
---

# Welcome to your thoughtbase

This is Minerva — a workshop for thinking in writing. You're reading your first
note. Edit it, or delete it once you've found your footing; every note is a plain
Markdown file on disk that you fully own.

A few ways in:

- **Press ${newNote} to create a new note.** That's the same shortcut whenever you
  want a fresh page.
- **Connect ideas with \`[[wiki-links]]\`.** Type \`[[\` and start naming another
  note — Minerva weaves the links into a knowledge graph you can query.
- **Label with tags and frontmatter.** Titles, tags, and links are all indexed;
  the \`entrypoint\` tag above is what marks this as your starting note.
- **Ask questions of your notes.** The **New Conversation** button above the editor
  starts one; right-click a note's tab and choose *Ask About This…* to start from
  that note — nothing lands in your graph without your approval.

When you're ready, press ${newNote} and start writing.
`;
}
