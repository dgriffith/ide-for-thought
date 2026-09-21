/**
 * Client-side conversation compaction logic (#824).
 *
 * Server-side compaction (`compact-2026-01-12`) needs raw `compaction` content
 * blocks preserved across turns, but Minerva stores messages as plain strings
 * — so `/compact` summarizes the early history with a model call and seeds a
 * fresh conversation with the summary + the retained recent turns. The pure
 * decision/assembly bits and the orchestration that drives them both live
 * here (#2237) — none of it needs Electron, and splitting them across an IPC
 * registrar is what hid `compactConversation` from anyone reading this file.
 */

import type { ConversationMessage, TurnUsage } from '../../shared/conversation';
import * as conversation from './conversation';

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

/**
 * `/compact` (#824): client-side compaction — the orchestration, moved out of
 * the IPC registrar in #2237 (epic #2241). The header above used to say "the
 * IPC handler does the model call + archive/create orchestration", which was a
 * description of where it happened to live rather than a reason: none of this
 * touches Electron. It reads a conversation, calls a model, archives, and
 * seeds a replacement. Summarizes the early history with
 * a model call and seeds a fresh conversation with the summary + the retained
 * recent turns. The pre-compaction original is archived (filed as a
 * thought:Source, recoverable from the archived list), never silently
 * destroyed. The summarization call's own token usage is recorded on the
 * summary message (#820). The decision/assembly helpers it drives are the exports above.
 */
export async function compactConversation(
  rootPath: string,
  convId: string,
): Promise<import('../../shared/conversation').CompactResult> {
  const conv = await conversation.load(rootPath, convId);
  if (!conv) throw new Error(`Conversation not found: ${convId}`);
  if (conv.status !== 'active') {
    return { compacted: false, reason: 'This conversation is archived and can\'t be compacted.' };
  }
  const { planCompaction, buildSummaryPrompt, buildSummaryMessage, COMPACT_SYSTEM_PROMPT } =
    await import('./compact');
  const plan = planCompaction(conv.messages);
  if (!plan.ok) return { compacted: false, reason: plan.reason };

  let usage: import('../../shared/conversation').TurnUsage | undefined;
  let usageModel: string | undefined;
  let truncated = false;
  const { complete } = await import('./index');
  const summary = await complete(buildSummaryPrompt(plan.transcript), {
    system: COMPACT_SYSTEM_PROMPT,
    model: conv.model,
    onUsage: (u, m) => { usage = u; usageModel = m; },
    onTruncated: () => { truncated = true; },
  });
  // A summary cut off at the token cap is the one truncation we refuse to live
  // with (#1811): compaction archives the original and makes this summary the
  // model's entire memory of it. Better to leave the conversation as it is and
  // say why than to install a half-written account of it.
  if (truncated) {
    return {
      compacted: false,
      reason: 'The summary of your earlier turns was cut off at the length limit, '
        + 'so nothing was compacted. Try again, or start a fresh conversation.',
    };
  }
  const summaryMsg = buildSummaryMessage(
    plan.prefix.length,
    summary,
    usage,
    usageModel,
    new Date().toISOString(),
  );

  // Archive the original (files the full transcript as a thought:Source —
  // recoverable) before opening the compacted continuation.
  await conversation.archive(rootPath, convId);
  const createOpts: { systemPrompt?: string; model?: string; webEnabled?: boolean } = {};
  if (conv.systemPrompt) createOpts.systemPrompt = conv.systemPrompt;
  if (conv.model) createOpts.model = conv.model;
  if (conv.webEnabled !== undefined) createOpts.webEnabled = conv.webEnabled;
  const fresh = await conversation.create(
    rootPath,
    conv.contextBundle,
    conv.triggerNodeUri,
    Object.keys(createOpts).length > 0 ? createOpts : undefined,
  );
  const updated = await conversation.replaceMessages(rootPath, fresh.id, [summaryMsg, ...plan.recent]);
  return { compacted: true, conversation: updated };
}
