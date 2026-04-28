import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';

const SYSTEM_PROMPT_WITH_NOTE = `You are designing an ordered learning path that ends at mastery of the note's topic.

First, propose a numbered journey of 3–8 stops. For each stop:
- **Name** the stop in 2–5 words
- **What you'll learn** — one sentence
- **Prerequisites** — note what the previous stop must have established; if none, say so
- **Why this stop** — one sentence on how it advances toward the note's topic

After the first journey, iterate with the user. They may want more stops, fewer, a different starting assumption (e.g. "assume I already know X"), or to skip/merge specific stops.

When the user is happy with the structure and wants it filed as notes, call the propose_notes tool with a bundle: one parent index note (the journey overview, with wiki-links to each child) plus one child note per stop (its content fleshed out). The user reviews the bundle as an inline card. Do NOT paste the same content inline in chat — the card is the deliverable.

Use web search when a stop is a term you need to look up for accuracy.`;

const SYSTEM_PROMPT_NO_NOTE = `You are designing an ordered learning path toward mastery of a topic the user will name.

Because no note is open, your FIRST response should be a short clarifying question: what is the destination — the topic the user wants to understand by the end of the journey? Optionally also ask their starting point ("what do you already know?"). Don't propose stops yet.

Once the destination is clear, propose a numbered journey of 3–8 stops. For each stop:
- **Name** the stop in 2–5 words
- **What you'll learn** — one sentence
- **Prerequisites** — note what the previous stop must have established; if none, say so
- **Why this stop** — one sentence on how it advances toward the destination

After the first journey, iterate with the user. They may want more stops, fewer, a different starting assumption, or to skip/merge specific stops.

When the user is happy with the structure and wants it filed as notes, call the propose_notes tool with a bundle: one parent index note (the journey overview, with wiki-links to each child) plus one child note per stop (its content fleshed out). The user reviews the bundle as an inline card. Do NOT paste the same content inline in chat — the card is the deliverable.

Use web search when a stop is a term you need to look up for accuracy.`;

registerTool({
  id: 'learning.create-learning-journey',
  name: 'Create Learning Journey',
  category: 'learning',
  description: 'Design an ordered learning path ending at mastery',
  longDescription:
    'Opens a conversation that proposes an ordered learning path from "where the user is now" to "understanding the destination topic." ' +
    'When a note is open the destination defaults to that note; otherwise the assistant asks what topic to learn. ' +
    'Iterate to shape the journey, then ask the assistant to file it as a parent index note + one child note per stop — reviewed inline as a single Proposal.',
  // Context is advisory: when fullNoteContent is missing the prompt adapts.
  context: ['fullNote'],
  outputMode: 'openConversation',
  slashCommand: '/learning-journey',
  preferredModel: 'claude-opus-4-7',
  web: { defaultEnabled: true },
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => {
    if (!ctx.fullNoteContent) return SYSTEM_PROMPT_NO_NOTE;
    const noteBlock = `\n\n## Note${ctx.fullNoteTitle ? ` — ${ctx.fullNoteTitle}` : ''}\n\n${ctx.fullNoteContent}`;
    return SYSTEM_PROMPT_WITH_NOTE + noteBlock;
  },
  buildFirstMessage: (ctx: ToolContext) => {
    // Without a note the assistant should ask for the destination first;
    // an auto-fired "Build me a learning journey" would force it to invent
    // the destination, which is exactly the friction we're trying to avoid.
    if (!ctx.fullNoteContent) return '';
    return 'Build me a learning journey.';
  },
});
