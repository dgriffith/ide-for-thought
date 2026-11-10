/**
 * "Ask in parallel" (#2974): one message sent as several branches — on
 * different models, from different perspectives, or simply several attempts —
 * and their answers joined side by side in the conversation that asked.
 *
 * Pure: the composer's dialog builds the branches here, main words each
 * branch's message and the join here, and both sides agree on the limits.
 */
import type { ForkAnswer, ParallelBranch } from './conversation';

export type ParallelMode = 'models' | 'perspectives' | 'attempts';

export const MIN_PARALLEL = 2;

/** The branches for a dialog's choice, at most `max`; blank perspectives and repeated models dropped. */
export function parallelBranches(
  choice:
    | { mode: 'models'; models: { id: string; label: string }[] }
    | { mode: 'perspectives'; perspectives: string[] }
    | { mode: 'attempts'; attempts: number },
  max: number,
): ParallelBranch[] {
  if (choice.mode === 'models') {
    const seen = new Set<string>();
    return choice.models
      .filter((m) => !seen.has(m.id) && seen.add(m.id))
      .slice(0, max)
      .map((m) => ({ title: m.label, model: m.id }));
  }
  if (choice.mode === 'perspectives') {
    return choice.perspectives
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .slice(0, max)
      .map((p) => ({ title: p.slice(0, 120), perspective: p }));
  }
  const n = Math.max(0, Math.min(max, Math.floor(choice.attempts)));
  return Array.from({ length: n }, (_, i) => ({ title: `Attempt ${i + 1}` }));
}

/** What a branch is sent: the message, then a skill branch's own instructions or the perspective to answer from. */
export function parallelMessage(message: string, branch: ParallelBranch): string {
  const instructions = branch.instructions?.trim();
  if (instructions) return `${message}\n\n${instructions}`;
  const perspective = branch.perspective?.trim();
  return perspective ? `${message}\n\n(Answer ${/^as\b/i.test(perspective) ? perspective : `as ${perspective}`}.)` : message;
}

/** The join as plain markdown: a section per branch, in the order they were asked. */
export function joinedAnswersMarkdown(answers: readonly ForkAnswer[]): string {
  return answers.map((a) => {
    const state = a.status === 'done' ? '' : ` (${a.note ?? a.status})`;
    return `### ${a.title}${state}\n\n${a.answer.trim() || '_No answer._'}`;
  }).join('\n\n');
}
