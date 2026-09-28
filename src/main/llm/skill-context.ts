/**
 * Where a skill's thoughtbase material goes: the first USER turn (#2438).
 *
 * A conversation launched from a skill carries two prompts: the skill's
 * instructions (pinned as `conv.systemPrompt`, appended to the conversation
 * system prompt) and the material they operate on — the note, selection,
 * claim or source, already wrapped in `<thoughtbase-content>` delimiters by
 * the template renderer. The material used to be rendered into the system
 * prompt, the highest-privilege channel, from a directory that arrives by zip
 * import, clone and folder sync.
 *
 * It is persisted on the conversation (`conv.skillContext`) rather than as a
 * visible message, so the chat shows "Summarize." and not a whole note, and it
 * is attached at send time — to whatever the first user turn is, which also
 * covers a skill with no `firstMessage` (the user types first) and a
 * conversation continued through /clear or /compact. Stable across turns, so
 * the prompt cache still hits.
 *
 * One function, used by the send path (`register-conversation.ts`) and the
 * eval harness (`src/cli/eval.ts`), so the goldens show what the app sends.
 */

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Return `messages` with `skillContext` at the start of the first user turn.
 *  Never mutates the input. A no-op for an empty context. */
export function withSkillContext<M extends ChatTurn>(messages: readonly M[], skillContext: string | undefined): M[] {
  const out = [...messages];
  const ctx = skillContext?.trim();
  if (!ctx) return out;
  const i = out.findIndex((m) => m.role === 'user');
  if (i === -1) {
    out.unshift({ role: 'user', content: ctx } as M);
    return out;
  }
  const first = out[i]!;
  out[i] = { ...first, content: first.content.trim() ? `${ctx}\n\n${first.content}` : ctx };
  return out;
}
