import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';

const DEPTH_DIRECTIVES: Record<string, string> = {
  overview: 'Single paragraph. Cover the term\u2019s meaning and its role in the note\u2019s context in under 150 words.',
  standard: 'Around 500 words. Cover mechanism, brief history, usage today, and one or two common misconceptions. Concrete examples welcome.',
  exhaustive: 'Multi-section dive suitable for promoting to its own note. Cover mechanism, history, usage, misconceptions, adjacent concepts, and where someone would go to learn more. Cite web sources when an outside fact is load-bearing.',
};

function depthDirective(value: string | undefined): string {
  return DEPTH_DIRECTIVES[value ?? 'standard'] ?? DEPTH_DIRECTIVES.standard;
}

const SYSTEM_PROMPT = `You are deep-diving a term or phrase the user selected in their note.

Use the surrounding note to calibrate depth and angle \u2014 don\u2019t repeat what the note already establishes about the term. Focus on explaining mechanism, history, usage, and common misconceptions. Draw from web search freely; cite when web evidence is load-bearing.

After the first response, iterate with the user \u2014 they may want more depth on one facet, a different angle, or to promote the result to a note.`;

registerTool({
  id: 'learning.deep-dive',
  name: 'Deep Dive on Term',
  category: 'learning',
  description: 'Expand a selected term into a fuller explanation',
  longDescription:
    'Opens a conversation that deep-dives a selected word or phrase, using the surrounding note as secondary context. ' +
    'Pick a depth \u2014 overview, standard (~500 words), or exhaustive (multi-section). The exhaustive mode is designed to be note-worthy; promote via Create Note from Conversation when ready.',
  context: ['selectedText', 'fullNote'],
  outputMode: 'openConversation',
  slashCommand: '/deep-dive',
  preferredModel: 'claude-sonnet-4-6',
  web: { defaultEnabled: true },
  requiresSelection: true,
  parameters: [
    {
      id: 'depth',
      label: 'Depth',
      type: 'select',
      options: [
        { label: 'Overview \u2014 one paragraph', value: 'overview' },
        { label: 'Standard \u2014 ~500 words', value: 'standard' },
        { label: 'Exhaustive \u2014 multi-section dive', value: 'exhaustive' },
      ],
      defaultValue: 'standard',
      required: true,
    },
  ],
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => {
    const selected = ctx.selectedText?.trim();
    if (!selected) {
      throw new Error('Deep Dive on Term requires a text selection.');
    }
    const noteBlock = ctx.fullNoteContent
      ? `\n\n## Surrounding note${ctx.fullNoteTitle ? ` \u2014 ${ctx.fullNoteTitle}` : ''}\n\n${ctx.fullNoteContent}`
      : '';
    const directive = depthDirective(ctx.parameterValues?.depth);
    return `${SYSTEM_PROMPT}\n\nTerm to deep-dive: **${selected}**\n\nDepth: ${directive}${noteBlock}`;
  },
  buildFirstMessage: (ctx: ToolContext) => {
    const selected = ctx.selectedText?.trim() ?? '\u2026';
    return `Explain "${selected}" in depth.`;
  },
});
