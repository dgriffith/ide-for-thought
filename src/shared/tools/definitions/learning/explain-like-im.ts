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

const SYSTEM_PROMPT_WITH_NOTE = `You are a tutor re-explaining a note the user is working in.

Tune your explanation to the audience level the user specified. Keep it accurate — simplify without falsifying. Use analogies, narrative, or concrete examples as the audience demands. You have web tools available; use them when a canonical example or external framing would help.

After the first explanation, iterate with the user — different angle, different slice, a specific point in more depth.

If the user wants the explanation filed as a new note (or split into a parent index plus per-section children), call the propose_notes tool with the bundle. Don't paste the same content inline as well — the inline review card is enough.`;

const SYSTEM_PROMPT_NO_NOTE = `You are a tutor explaining a topic the user wants to understand.

Because no note is open, your first response should be a short clarifying question: what topic do you want explained, and at what audience level (if they didn't already pick one)? After that, follow the same explain-then-iterate flow.

Tune your explanation to the audience level the user specified. Keep it accurate — simplify without falsifying. Use analogies, narrative, or concrete examples as the audience demands. You have web tools available; use them when a canonical example or external framing would help.

If the user wants the explanation filed as a new note (or split into a parent index plus per-section children), call the propose_notes tool with the bundle. Don't paste the same content inline as well — the inline review card is enough.`;

registerTool({
  id: 'learning.explain-like-im',
  name: 'Explain Like I’m…',
  category: 'learning',
  description: 'Re-explain a topic at a chosen audience level',
  longDescription:
    'Opens a conversation that re-explains a topic tuned to an audience level — child, high schooler, undergrad, or expert in an adjacent field. ' +
    'Works against the active note when one is open; otherwise asks you what topic you want explained. ' +
    'From the first response onward you can iterate on angle, depth, or specific confusing points, and ask the assistant to file the explanation as new notes.',
  // Context is advisory: when fullNoteContent is missing the system prompt
  // adapts and the conversation opens with a clarifying question instead of
  // an auto-fired "explain this".
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
        { label: 'Child — a curious 8-year-old', value: 'child' },
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
    const phrase = audiencePhrase(ctx.parameterValues?.audience);
    if (!ctx.fullNoteContent) {
      return `${SYSTEM_PROMPT_NO_NOTE}\n\nAudience: ${phrase}.`;
    }
    const noteBlock = `\n\n## Note${ctx.fullNoteTitle ? ` — ${ctx.fullNoteTitle}` : ''}\n\n${ctx.fullNoteContent}`;
    return `${SYSTEM_PROMPT_WITH_NOTE}\n\nAudience: ${phrase}.${noteBlock}`;
  },
  buildFirstMessage: (ctx: ToolContext) => {
    if (!ctx.fullNoteContent) return '';
    return `Explain this like I’m ${audiencePhrase(ctx.parameterValues?.audience)}.`;
  },
});
