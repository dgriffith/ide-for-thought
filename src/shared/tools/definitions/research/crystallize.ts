import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';
import SYSTEM_PROMPT from './crystallize.prompt.md?raw';

registerTool({
  id: 'research.crystallize',
  name: 'Crystallize as Components',
  category: 'research',
  description: 'Extract thought components and file as a crystallization note',
  longDescription:
    'Opens a conversation that extracts structured thought components (claims, grounds, hypotheses, ' +
    'observations, etc.) from the active note and files ONE crystallization note containing an embedded ' +
    'Turtle block. The graph indexer auto-extracts the components on save, so they land in the graph ' +
    'with a navigable note as their paper trail.',
  context: ['fullNote'],
  outputMode: 'openConversation',
  preferredModel: 'claude-sonnet-4-6',
  web: { defaultEnabled: false },
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => {
    const path = ctx.fullNotePath ?? '(no active note)';
    const noteBlock = ctx.fullNoteContent
      ? `\n\n## Source note (\`${path}\`)\n\n${ctx.fullNoteContent}`
      : '\n\n## Source note\n\nNo note is open. Ask the user which note to crystallize before proceeding.';
    return SYSTEM_PROMPT + noteBlock;
  },
  buildFirstMessage: (ctx: ToolContext) => {
    const path = ctx.fullNotePath ?? '';
    return path
      ? `Crystallize \`${path}\` as components.`
      : 'Crystallize this note as components.';
  },
});
