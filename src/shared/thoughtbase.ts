/**
 * `thoughtbase.md` — the thoughtbase's own guide.
 *
 * A user-authored, plain-English file at the project root describing the
 * thoughtbase's structure, intent, and conventions — analogous to CLAUDE.md for
 * Claude Code. When present, its contents are injected into every conversation's
 * system prompt (see `main/llm/thoughtbase-doc.ts`). Shared here so main
 * (injection, indexing exclusion) and the renderer (the "Edit Thoughtbase
 * Guide" affordance) agree on the one filename.
 */

/** Root-relative filename of the thoughtbase guide. */
export const THOUGHTBASE_DOC_FILENAME = 'thoughtbase.md';

/** Starter content written when the user opens the guide for a thoughtbase that
 *  doesn't have one yet. HTML comments explain each section without cluttering
 *  what the assistant reads once the user fills it in. */
export const THOUGHTBASE_DOC_TEMPLATE = `# Thoughtbase Guide

<!--
This file describes your thoughtbase — its structure, intent, and conventions —
in plain English. Its contents are shown to the AI assistant at the start of
every conversation, so it understands how this thoughtbase is organized and how
you want it to work within it. Edit freely; delete the file to opt out.
-->

## What this thoughtbase is for

<!-- A sentence or two on the purpose or domain of this thoughtbase. -->

## Structure & conventions

<!-- How notes are organized (folders, tags, naming), and any conventions the
     assistant should follow — e.g. "prefer wiki-links over tags", or "file new
     claims under notes/claims/". -->

## Working preferences

<!-- How you'd like the assistant to respond or file things in this thoughtbase. -->
`;
