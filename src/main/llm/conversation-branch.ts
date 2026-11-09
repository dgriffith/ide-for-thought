/**
 * Branches (#2970): a conversation forked from another at one of its messages.
 *
 * A branch is an ordinary conversation file, written through the same lock, so
 * every existing tool works on it. What makes it a branch is `branch` — its
 * parent and where it forked — and how it starts:
 *
 * - **summary** (the default): one opening message, a summary of the parent
 *   so far (the `/compact` summarizer) followed by the branch's instructions.
 *   Cheaper and focused: the branch gets what the parent knows, not every turn.
 * - **full**: the parent's turns up to the fork, then the instructions.
 *
 * Either way the opening ends in a user turn, so a turn can run on it at once
 * (the retry path runs over what's on disk). It keeps the parent's skill
 * context, system prompt, model, effort, web setting, skill and thoughtbase
 * scope unless the fork names another model.
 *
 * Stopping or archiving a parent reaches its branches, and theirs: see
 * `descendantsOf`.
 */
import type { BranchCreateOptions, Conversation, ConversationCreateOptions, ConversationMessage, TurnUsage } from '../../shared/conversation';
import * as conversation from './conversation';
import { COMPACT_SYSTEM_PROMPT, buildSummaryPrompt } from './compact';
import { costForUsage } from '../../shared/tools/models';

export interface BranchDeps {
  /** One completion, as `llm/index.ts`'s `complete`. */
  complete: (prompt: string, options: {
    system: string;
    model?: string | undefined;
    onUsage?: (usage: TurnUsage, model: string) => void;
    onTruncated?: () => void;
  }) => Promise<string>;
}

export const defaultBranchDeps: BranchDeps = {
  complete: (prompt, options) => import('./index').then((m) => m.complete(prompt, options)),
};

/**
 * Deps whose summary is made once and shared (#2971): a fork's branches all
 * start from the same parent, so they share one summary call. Its cost is
 * charged to the first branch that asked; the rest get the text alone.
 */
export function sharedSummary(deps: BranchDeps): BranchDeps {
  const made = new Map<string, Promise<{ text: string; truncated: boolean }>>();
  return {
    complete: async (prompt, options) => {
      let pending = made.get(prompt);
      if (!pending) {
        // Only this first caller's options (and so its onUsage) reach the call.
        let truncated = false;
        pending = deps.complete(prompt, {
          ...options,
          onTruncated: () => { truncated = true; },
        }).then((text) => ({ text, truncated }));
        made.set(prompt, pending);
      }
      const { text, truncated } = await pending;
      if (truncated) options.onTruncated?.();
      return text;
    },
  };
}

export async function createBranch(
  rootPath: string,
  parentId: string,
  opts: BranchCreateOptions,
  deps: BranchDeps = defaultBranchDeps,
): Promise<Conversation> {
  const parent = await conversation.load(rootPath, parentId);
  if (!parent) throw new Error(`Conversation not found: ${parentId}`);
  if (parent.status !== 'active') throw new Error('This conversation is archived and can’t be branched.');
  const title = opts.title.trim();
  if (!title) throw new Error('A branch needs a name.');
  const context = opts.context ?? 'summary';
  const atMessage = Math.max(0, Math.min(opts.atMessage ?? parent.messages.length, parent.messages.length));
  const history = parent.messages.slice(0, atMessage).filter((m) => m.role !== 'system');
  const instructions = opts.instructions?.trim() ?? '';
  const now = new Date().toISOString();

  const messages: ConversationMessage[] = [];
  if (context === 'full') {
    // Copied turns carry no usage: the parent already paid for them, and the
    // branch's cost should be its own.
    for (const m of history) messages.push({ role: m.role, content: m.content, timestamp: m.timestamp });
    if (instructions) messages.push({ role: 'user', content: instructions, timestamp: now });
  } else {
    const parts: string[] = [];
    let usage: TurnUsage | undefined;
    let usageModel: string | undefined;
    if (history.length > 0) {
      let truncated = false;
      const transcript = history.map((m) => `[${m.role}] ${m.content}`).join('\n\n');
      const summary = await deps.complete(buildSummaryPrompt(transcript), {
        system: COMPACT_SYSTEM_PROMPT,
        model: parent.model,
        onUsage: (u, m) => { usage = u; usageModel = m; },
        onTruncated: () => { truncated = true; },
      });
      // The summary is the branch's whole memory of the parent: a cut-off one
      // would start it on half an account, so say so instead (as /compact does).
      if (truncated) throw new Error('The summary of this conversation was cut off at the length limit. Branch with its full context instead.');
      parts.push(`**Summary of the conversation this branched from** (${history.length} messages):\n\n${summary.trim()}`);
    }
    if (instructions) parts.push(parts.length > 0 ? `**This branch:** ${instructions}` : instructions);
    if (parts.length > 0) {
      messages.push({
        role: 'user', content: parts.join('\n\n'), timestamp: now,
        ...(usage ? { usage } : {}), ...(usageModel ? { usageModel } : {}),
        ...(usage && usageModel && costForUsage(usage, usageModel) !== null ? { costUSD: costForUsage(usage, usageModel)! } : {}),
      });
    }
  }

  const createOpts: ConversationCreateOptions = {};
  if (parent.systemPrompt) createOpts.systemPrompt = parent.systemPrompt;
  if (parent.skillContext) createOpts.skillContext = parent.skillContext;
  const model = opts.model ?? parent.model;
  if (model) createOpts.model = model;
  if (parent.webEnabled !== undefined) createOpts.webEnabled = parent.webEnabled;
  if (parent.skill) createOpts.skill = parent.skill;
  return conversation.create(rootPath, parent.contextBundle, parent.triggerNodeUri, createOpts, {
    branch: { parentId, atMessage, context },
    title,
    ...(parent.effort ? { effort: parent.effort } : {}),
    messages,
  });
}

/** Every conversation branched from `id`, and from those, in no particular order. */
export function descendantsOf(all: readonly Conversation[], id: string): Conversation[] {
  const byParent = new Map<string, Conversation[]>();
  for (const c of all) {
    if (!c.branch) continue;
    const list = byParent.get(c.branch.parentId) ?? [];
    list.push(c);
    byParent.set(c.branch.parentId, list);
  }
  const out: Conversation[] = [];
  const seen = new Set<string>([id]);
  const queue = [id];
  while (queue.length > 0) {
    for (const child of byParent.get(queue.shift()!) ?? []) {
      if (seen.has(child.id)) continue; // a hand-edited loop ends here
      seen.add(child.id);
      out.push(child);
      queue.push(child.id);
    }
  }
  return out;
}

/** Archive a conversation and every active branch under it. Resolves to the parent. */
export async function archiveWithBranches(rootPath: string, id: string): Promise<Conversation> {
  const archived = await conversation.archive(rootPath, id);
  for (const b of descendantsOf(await conversation.listAll(rootPath), id)) {
    if (b.status === 'active') await conversation.archive(rootPath, b.id);
  }
  return archived;
}
