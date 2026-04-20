import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';

const AUDIENCE_PHRASES: Record<string, string> = {
  child: 'a curious 8-year-old',
  highschool: 'a bright high schooler',
  undergrad: 'a motivated undergrad new to the topic',
  expert: 'an expert in an adjacent field',
};

function audiencePhrase(value: string | undefined): string {
  return AUDIENCE_PHRASES[value ?? 'undergrad'] ?? AUDIENCE_PHRASES.undergrad;
}

const SYSTEM_PROMPT = `You are a tutor re-explaining a note the user is working in.

Tune your explanation to the audience level the user specified. Keep it accurate — simplify without falsifying. Use analogies, narrative, or concrete examples as the audience demands. You have web tools available; use them when a canonical example or external framing would help.

After the first explanation, iterate with the user — different angle, different slice, a specific point in more depth.`;

registerTool({
  id: 'learning.explain-like-im',
  name: 'Explain Like I\u2019m\u2026',
  category: 'learning',
  description: 'Re-explain the note at a chosen audience level',
  longDescription:
    'Opens a conversation that re-explains the active note tuned to an audience level — child, high schooler, undergrad, or expert in an adjacent field. ' +
    'The first response is the re-explanation; from there you can iterate on angle, depth, or specific confusing points.',
  context: ['fullNote'],
  outputMode: 'openConversation',
  slashCommand: '/eli',
  preferredModel: 'claude-sonnet-4-6',
  web: { defaultEnabled: true },
  parameters: [
    {
      id: 'audience',
      label: 'Audience level',
      type: 'select',
      options: [
        { label: 'Child \u2014 a curious 8-year-old', value: 'child' },
        { label: 'High schooler', value: 'highschool' },
        { label: 'Undergrad new to the topic', value: 'undergrad' },
        { label: 'Expert in an adjacent field', value: 'expert' },
      ],
      defaultValue: 'undergrad',
      required: true,
    },
  ],
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => {
    const noteBlock = ctx.fullNoteContent
      ? `\n\n## Note${ctx.fullNoteTitle ? ` \u2014 ${ctx.fullNoteTitle}` : ''}\n\n${ctx.fullNoteContent}`
      : '';
    const phrase = audiencePhrase(ctx.parameterValues?.audience);
    return `${SYSTEM_PROMPT}\n\nAudience: ${phrase}.${noteBlock}`;
  },
  buildFirstMessage: (ctx: ToolContext) =>
    `Explain this like I\u2019m ${audiencePhrase(ctx.parameterValues?.audience)}.`,
});
