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
 *
 * The prose leads with WHY a thoughtbase, in the website's framing, rather than
 * with Minerva's mechanics — someone who has just declined the onboarding modal
 * has no reason yet to care how the knowledge graph works. It also never points
 * at the properties block "above": the editor collapses it by default, so on
 * most screens there is nothing there to see.
 */
export function welcomeNoteContent(isMac: boolean): string {
  const newNote = isMac ? '⌘N' : 'Ctrl+N';
  return `---
tags:
  - entrypoint
---

# Welcome to your thoughtbase

Somewhere in your chat history is a genuinely good idea you worked out with an
AI a few weeks ago. You can't find it. It wasn't written down anywhere you own,
it didn't connect to anything else you know, and the next conversation started
from nothing.

This is where that work goes instead. A **thoughtbase** is a place your thinking
lands and stays — notes you keep, link, question, and build on for years rather
than until you close a tab. Every note you add gives the next conversation more
to work with, so what you write compounds instead of scrolling away.

Three things worth knowing before you start:

- **You stay in control.** The assistant proposes; you decide. Nothing it writes
  reaches your notes until you've read it and approved it.
- **It's yours, permanently.** Every note is a plain Markdown file in a folder
  on your own disk. No account, no server. If Minerva disappeared tomorrow, your
  thinking would still open in any text editor.
- **It gets better as it grows.** Notes that link to each other are worth more
  than notes in a pile — and the assistant can answer from what you actually
  wrote, telling you which note each answer came from.

## Try three things

**Write something.** Press ${newNote} and start a note about whatever you're
actually working on today. A paragraph is plenty. This note is yours to edit or
delete once you've found your footing.

**Connect it to something.** Type \`[[\` anywhere and start naming another note.
Links are what turn a folder of files into a map of what you know — and you can
link to a note before you've written it.

**Ask about your notes.** The **New Conversation** button above the editor
starts a conversation that can read what you've written. Right-click a note's
tab and choose *Ask About This…* to start from one note in particular. Whatever
it suggests, you see before it lands.

## When you want more

A note can carry **properties** — labelled fields like an author or a date — and
tags for grouping. Settings has the rest: how the editor behaves, which AI
models you use, and what gets checked as you write.

Press ${newNote} when you're ready.
`;
}
