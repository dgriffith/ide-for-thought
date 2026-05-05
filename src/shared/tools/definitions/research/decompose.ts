import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';
import SYSTEM_PROMPT from './decompose.prompt.md?raw';

registerTool({
  id: 'research.decompose',
  name: 'Decompose into Linked Notes',
  category: 'research',
  description: 'Split the note into a parent index + 2–7 focused children',
  longDescription:
    'Opens a conversation that decomposes the active note into a parent index note plus 2–7 ' +
    'topic-focused child notes, filed as a single propose_notes bundle. The agent picks the split axis ' +
    '— sections, topics, or argument structure — and asks via ask_user only when the axis is genuinely ' +
    'ambiguous. Each child stands on its own; together they losslessly cover the source.',
  context: ['fullNote'],
  outputMode: 'openConversation',
  preferredModel: 'claude-opus-4-7',
  web: { defaultEnabled: false },
  requiresTools: ['ask_user'],
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => {
    const path = ctx.fullNotePath ?? '(no active note)';
    const noteBlock = ctx.fullNoteContent
      ? `\n\n## Source note (\`${path}\`)\n\n${ctx.fullNoteContent}`
      : '\n\n## Source note\n\nNo note is open. Ask the user which note to decompose before proceeding.';
    return SYSTEM_PROMPT + noteBlock;
  },
  buildFirstMessage: (ctx: ToolContext) => {
    const path = ctx.fullNotePath ?? '';
    return path
      ? `Decompose \`${path}\` into linked smaller notes.`
      : 'Decompose this note into linked smaller notes.';
  },
});
