import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';

const DIFFICULTY_DIRECTIVES: Record<string, string> = {
  recall: 'Focus on factual recall \u2014 terms, definitions, direct statements from the note.',
  apply: 'Focus on application and inference \u2014 ask the user to apply the note\u2019s claims to new cases, draw out implications, or identify which claim explains a given situation.',
  synthesis: 'Focus on cross-topic synthesis and stress cases \u2014 ask the user to connect the note\u2019s ideas to other domains, find tensions between claims, or defend the claims against a counterexample you supply.',
};

function difficultyDirective(value: string | undefined): string {
  return DIFFICULTY_DIRECTIVES[value ?? 'apply'] ?? DIFFICULTY_DIRECTIVES.apply;
}

const SYSTEM_PROMPT = `You are a quiz master testing the user\u2019s understanding of a note they wrote.

Ask one question at a time. When the user answers, grade honestly (**correct**, **partial**, or **incorrect**), explain the full answer, then ask the next question. Adapt difficulty to their performance \u2014 go harder if they\u2019re breezing through, back off if they\u2019re struggling. Aim for 5\u201310 questions unless the user stops earlier.

End with a one-paragraph assessment of which areas they\u2019ve mastered and which need more work.`;

registerTool({
  id: 'learning.quiz-me',
  name: 'Quiz Me',
  category: 'learning',
  description: 'Test your understanding of the note with graded questions',
  longDescription:
    'Opens a conversation where an LLM quizzes you on the active note. Ask a question, grade your answer, explain, repeat. ' +
    'Adjusts difficulty to your performance and wraps with an assessment of strong and weak areas.',
  context: ['fullNote'],
  outputMode: 'openConversation',
  slashCommand: '/quiz',
  preferredModel: 'claude-sonnet-4-6',
  web: { defaultEnabled: true },
  parameters: [
    {
      id: 'difficulty',
      label: 'Difficulty',
      type: 'select',
      options: [
        { label: 'Recall \u2014 facts and definitions', value: 'recall' },
        { label: 'Apply \u2014 application and inference', value: 'apply' },
        { label: 'Synthesis \u2014 cross-topic and stress cases', value: 'synthesis' },
      ],
      defaultValue: 'apply',
      required: true,
    },
  ],
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => {
    const noteBlock = ctx.fullNoteContent
      ? `\n\n## Note${ctx.fullNoteTitle ? ` \u2014 ${ctx.fullNoteTitle}` : ''}\n\n${ctx.fullNoteContent}`
      : '';
    const directive = difficultyDirective(ctx.parameterValues?.difficulty);
    return `${SYSTEM_PROMPT}\n\nDifficulty focus: ${directive}${noteBlock}`;
  },
  buildFirstMessage: () => 'Quiz me.',
});
