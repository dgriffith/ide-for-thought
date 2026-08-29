/**
 * Client-side conversation compaction logic (#824).
 *
 * Server-side compaction (`compact-2026-01-12`) needs raw `compaction` content
 * blocks preserved across turns, but Minerva stores messages as plain strings
 * — so `/compact` summarizes the early history with a model call and seeds a
 * fresh conversation with the summary + the retained recent turns. The pure
 * decision/assembly bits live here so they're testable without IPC; the IPC
 * handler does the model call + archive/create orchestration.
 */

import type { ConversationMessage, TurnUsage } from '../../shared/conversation';

/** Earlier turns kept verbatim after a compaction, for continuity. Four
 *  messages ≈ the last two exchanges. */
export const COMPACT_KEEP_RECENT = 4;

/** Below this many messages there's nothing worth summarizing. */
export const COMPACT_MIN_MESSAGES = COMPACT_KEEP_RECENT + 4;

export const COMPACT_SYSTEM_PROMPT = [
  'You are compacting a long assistant conversation so it stays within a workable length.',
  'Produce a faithful, information-dense summary of the conversation so far.',
  "Preserve: the user's goals and constraints, key facts and decisions, open questions, and every",
  'file path, note name, source, or identifier referenced — anything needed to continue the work.',
  'Use concise bullet points or short paragraphs. Do NOT invent information or add commentary;',
  'summarize only what is in the transcript.',
].join('\n');

export type CompactionPlan =
  | { ok: false; reason: string }
  | { ok: true; prefix: ConversationMessage[]; recent: ConversationMessage[]; transcript: string };

/**
 * Decide whether/how to compact. A short thread is left alone; otherwise the
 * earliest `length - KEEP_RECENT` messages are summarized and the last
 * KEEP_RECENT kept verbatim. `transcript` is the role-labeled text fed to the
 * summarizer (internal `system` messages excluded).
 */
export function planCompaction(messages: ConversationMessage[]): CompactionPlan {
  if (messages.length < COMPACT_MIN_MESSAGES) {
    return { ok: false, reason: 'This conversation is too short to compact.' };
  }
  const cutoff = messages.length - COMPACT_KEEP_RECENT;
  const prefix = messages.slice(0, cutoff);
  const recent = messages.slice(cutoff);
  const transcript = prefix
    .filter((m) => m.role !== 'system')
    .map((m) => `[${m.role}] ${m.content}`)
    .join('\n\n');
  return { ok: true, prefix, recent, transcript };
}

export function buildSummaryPrompt(transcript: string): string {
  return `Summarize the following earlier portion of a conversation:\n\n${transcript}`;
}

/**
 * The single condensed message that replaces the summarized prefix. Role is
 * `user` (not `system`) deliberately: the conversation send path filters out
 * `system` messages, and a `user`-role summary keeps the API's first-message-
 * is-user invariant when the compacted history is sent on the next turn. Usage
 * from the summarization call rides along so its cost is counted (#820/#821).
 */
export function buildSummaryMessage(
  prefixCount: number,
  summary: string,
  usage: TurnUsage | undefined,
  usageModel: string | undefined,
  timestamp: string,
): ConversationMessage {
  return {
    role: 'user',
    content: `**Summary of earlier conversation** (${prefixCount} messages compacted):\n\n${summary.trim()}`,
    timestamp,
    ...(usage ? { usage } : {}),
    ...(usageModel ? { usageModel } : {}),
  };
}
