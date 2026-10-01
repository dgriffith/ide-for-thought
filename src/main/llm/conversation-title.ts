/**
 * Model-written conversation titles, Claude Desktop style.
 *
 * After a conversation's first exchange, one small background call names it.
 * Display metadata only: the title is stored on the conversation's JSON (never
 * projected into the graph) and shown on its tab and in the list. A user's
 * rename (`titleSource: 'user'`) always wins, and an auto title never replaces
 * one that's already there, so the model names a conversation at most once.
 *
 * Cheap on purpose: it runs on the conversation provider's quick tier
 * (`TIER_MODELS`: Sonnet 5, GPT-6 Luna, Gemini Flash) at low effort, not the
 * conversation's own model, which may be a premium one. A local model has no
 * tier to drop to, so it titles with itself.
 */
import { providerForModel } from '../../shared/tools/models';
import { TIER_MODELS, isResettableProvider } from '../../shared/tools/model-tiers';
import { UNTRUSTED_CONTENT_RULE, wrapUntrusted } from '../../shared/untrusted-content';
import type { Conversation } from '../../shared/conversation';
import { logger } from '../../shared/logger';

/** Longest title kept, in characters; cut back to a word boundary. */
export const MAX_TITLE_CHARS = 60;
/** How much of each opening message the title call reads. */
const EXCERPT_CHARS = 2000;

const TITLE_SYSTEM =
  'You name conversations. Reply with ONLY a short title for the conversation ' +
  'below: 2 to 6 words, in the language of the conversation, sentence case, no ' +
  'quotation marks, no trailing punctuation, no emoji. Name the subject, not the ' +
  'request ("Mandolin tuning history", not "Question about mandolins").\n\n' +
  UNTRUSTED_CONTENT_RULE;

/** The model that titles a conversation running on `conversationModel`. */
export function titleModelFor(conversationModel: string): string {
  const provider = providerForModel(conversationModel);
  return provider && isResettableProvider(provider) ? TIER_MODELS[provider].quick : conversationModel;
}

/** True when `conv` has just completed its first exchange and has no title. */
export function wantsAutoTitle(conv: Conversation): boolean {
  if (conv.title) return false;
  const assistantTurns = conv.messages.filter((m) => m.role === 'assistant').length;
  return assistantTurns === 1;
}

/** The opening exchange, delimited as data, for the title call's user turn. */
export function titlePrompt(conv: Conversation): string | null {
  const firstUser = conv.messages.find((m) => m.role === 'user')?.content.trim();
  const firstReply = conv.messages.find((m) => m.role === 'assistant')?.content.trim();
  if (!firstUser) return null;
  const excerpt = `User: ${firstUser.slice(0, EXCERPT_CHARS)}` + (firstReply ? `\n\nAssistant: ${firstReply.slice(0, EXCERPT_CHARS)}` : '');
  return `Title this conversation.\n\n${wrapUntrusted('conversation-excerpt', excerpt)}`;
}

/**
 * Turn a model reply into a usable title: first non-empty line, markdown and
 * quotes stripped, whitespace collapsed, cut to MAX_TITLE_CHARS at a word
 * boundary. `null` when nothing usable is left.
 */
export function sanitizeTitle(raw: string): string | null {
  const line = raw.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  let t = line
    .replace(/^(title\s*:\s*)/i, '')
    .replace(/^#+\s*/, '')
    .replace(/[*_`]/g, '')
    .replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.!?:;,]+$/, '')
    .trim();
  if (t.length > MAX_TITLE_CHARS) {
    const cut = t.slice(0, MAX_TITLE_CHARS);
    const space = cut.lastIndexOf(' ');
    t = (space > MAX_TITLE_CHARS / 2 ? cut.slice(0, space) : cut).trim();
  }
  return t.length > 0 ? t : null;
}

export interface AutoTitleDeps {
  /** `llm/index.complete` — injected so tests need no provider. */
  complete: (prompt: string, options: { system: string; model: string; effort: 'low' }) => Promise<string>;
  /** The conversation's effective model (its override, else the global default). */
  conversationModel: string;
}

/** Ask the model for a title. `null` when there's nothing to title or the reply is unusable. */
export async function generateTitle(conv: Conversation, deps: AutoTitleDeps): Promise<string | null> {
  const prompt = titlePrompt(conv);
  if (!prompt) return null;
  const raw = await deps.complete(prompt, { system: TITLE_SYSTEM, model: titleModelFor(deps.conversationModel), effort: 'low' });
  return sanitizeTitle(raw);
}

export interface AutoTitleRun {
  complete: AutoTitleDeps['complete'];
  /** The global settings: the default model, and whether auto-titling is on. */
  settings: { model: string; autoTitleConversations?: boolean | undefined };
  /** Persist an `auto` title (never overwrites an existing one). */
  setTitle: (title: string) => Promise<{ changed: boolean }>;
  /** Tell the renderer, once the title is saved. */
  notify: (title: string) => void;
}

/**
 * The whole background step after a reply: title the conversation if it just
 * finished its first exchange, has no title, and auto-titling is on. Returns the
 * title it saved, or `null`. Never throws into the caller — a title is a nicety,
 * and a failed one must not surface as a failed turn.
 */
export async function autoTitleConversation(conv: Conversation, run: AutoTitleRun): Promise<string | null> {
  if (run.settings.autoTitleConversations === false || !wantsAutoTitle(conv)) return null;
  try {
    const title = await generateTitle(conv, { complete: run.complete, conversationModel: conv.model ?? run.settings.model });
    if (!title) return null;
    const { changed } = await run.setTitle(title);
    if (!changed) return null; // renamed (or titled) while we were asking
    run.notify(title);
    return title;
  } catch (err) {
    logger('conversation').warn('auto-title failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
