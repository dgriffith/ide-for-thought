import fs from 'node:fs/promises';
import path from 'node:path';
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';
import { escapeTurtleLiteral } from './turtle';
import { costForUsage } from '../../shared/tools/models';
import type {
  Conversation,
  ConversationCreateOptions,
  ConversationMessage,
  ContextBundle,
  ConversationStatus,
  ConversationsUIState,
} from '../../shared/types';

/** The panel's state for a window with no project open — also what the IPC
 *  layer hands back in that case (#1743). */
export const DEFAULT_UI_STATE: ConversationsUIState = {
  visible: false,
  height: 320,
  activeTabId: null,
};

const THOUGHT = 'https://minerva.dev/ontology/thought#';

/**
 * Every entry point takes the project it operates on (#1743). This module used
 * to keep the open project in two module-level variables, set by an
 * `initConversations(rootPath)` that `project-context` called once per project
 * — so with two thoughtbases open, whichever was opened *second* silently owned
 * conversation storage for BOTH windows: window A's transcripts were written
 * into project B's `.minerva/conversations/`, its tab list came back as B's,
 * and its conversation triples landed in B's graph. Every other per-project
 * subsystem (graph, tables, search, vectors) is keyed by project; this one was
 * the straggler. Passing the root path in leaves nowhere for that state to hide.
 */
function convDir(rootPath: string): string {
  return path.join(rootPath, '.minerva', 'conversations');
}

/**
 * Re-project every persisted conversation into the graph. Called once
 * during project init: `writeConversationToGraph` clears prior triples
 * for the subject before re-adding, so historical bad-shape triples
 * (the #350 relative-path-as-IRI bug) get scrubbed and replaced with
 * the corrected IRI form. Cheap: small JSON files, in-memory rdflib.
 */
export async function reindexAllConversations(rootPath: string): Promise<void> {
  const dir = convDir(rootPath);
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch { return; /* no conversations yet */ }
  for (const file of files) {
    // Skip the `_ui.json` UI-state file (and any other underscore-prefixed
    // sibling files we add later) so they don't get parsed as conversations
    // — without this guard the JSON parses but lacks `contextBundle`, and
    // writeConversationToGraph dereferences it.
    if (!file.endsWith('.json') || file.startsWith('_')) continue;
    try {
      const data = await fs.readFile(path.join(dir, file), 'utf-8');
      const conv = migrateOnLoad(JSON.parse(data) as Conversation);
      writeConversationToGraph(rootPath, conv);
      if (conv.status !== 'active') {
        // Mirror the live status so archive doesn't get dropped on reload.
        updateConversationInGraph(rootPath, conv);
      }
    } catch (err) {
      console.warn(`[conversation] reindex skipped ${file}:`, err);
    }
  }
}

function convPath(rootPath: string, id: string): string {
  return path.join(convDir(rootPath), `${id}.json`);
}

function generateId(): string {
  return `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── CRUD ───────────────────────────────────────────────────────────────────

export async function create(
  rootPath: string,
  contextBundle: ContextBundle,
  triggerNodeUri?: string,
  options?: ConversationCreateOptions,
): Promise<Conversation> {
  const dir = convDir(rootPath);
  await fs.mkdir(dir, { recursive: true });

  const now = new Date().toISOString();
  const conv: Conversation = {
    id: generateId(),
    ...(triggerNodeUri !== undefined ? { triggerNodeUri } : {}),
    contextBundle,
    messages: [],
    status: 'active',
    startedAt: now,
  };
  if (options?.systemPrompt) conv.systemPrompt = options.systemPrompt;
  if (options?.model) conv.model = options.model;
  if (options?.webEnabled !== undefined) conv.webEnabled = options.webEnabled;
  if (options?.skill) conv.skill = options.skill;

  await persist(rootPath, conv);
  writeConversationToGraph(rootPath, conv);
  return conv;
}

export async function appendMessage(
  rootPath: string,
  id: string,
  role: ConversationMessage['role'],
  content: string,
  extra?: Partial<Pick<ConversationMessage, 'citations' | 'usage' | 'usageModel'>>,
): Promise<Conversation> {
  const conv = await load(rootPath, id);
  if (!conv) throw new Error(`Conversation not found: ${id}`);
  if (conv.status !== 'active') throw new Error(`Conversation ${id} is ${conv.status}, cannot append`);

  const message: ConversationMessage = {
    role,
    content,
    timestamp: new Date().toISOString(),
  };
  if (extra?.citations && extra.citations.length > 0) {
    message.citations = extra.citations;
  }
  // Persist per-turn token usage + producing model on the assistant message
  // so the conversation's running cost survives reload (#820), and derive the
  // dollar cost once at append time (#821). An unpriced model leaves costUSD
  // absent — the UI shows tokens only rather than a guessed figure.
  if (extra?.usage) {
    message.usage = extra.usage;
    if (extra.usageModel) {
      message.usageModel = extra.usageModel;
      const cost = costForUsage(extra.usage, extra.usageModel);
      if (cost !== null) message.costUSD = cost;
    }
  }
  conv.messages.push(message);
  await persist(rootPath, conv);
  return conv;
}

/**
 * Single terminal state. Closing a tab archives the conversation; the
 * `thought:Source` filing is preserved (provenance is still useful even
 * with one archive state). Idempotent — archiving an already-archived
 * conversation no-ops past the load.
 */
export async function archive(rootPath: string, id: string): Promise<Conversation> {
  const conv = await load(rootPath, id);
  if (!conv) throw new Error(`Conversation not found: ${id}`);
  if (conv.status === 'archived') return conv;

  conv.status = 'archived';
  conv.archivedAt = new Date().toISOString();

  await persist(rootPath, conv);
  updateConversationInGraph(rootPath, conv);
  await fileAsSource(rootPath, conv);
  return conv;
}

/**
 * Persist (or clear) the code-execution container id that the API
 * needs echoed back on every follow-up turn whose message history
 * still references a `server_tool_use` block. Called from the
 * conversation IPC handler after `completeWithTools` returns. No
 * graph projection — this is purely API-protocol state.
 */
export async function setContainerId(
  rootPath: string,
  id: string,
  containerId: string | undefined,
  expiresAt: string | undefined,
): Promise<void> {
  const conv = await load(rootPath, id);
  if (!conv) return;
  if (containerId) {
    conv.containerId = containerId;
    if (expiresAt) conv.containerExpiresAt = expiresAt;
    else delete conv.containerExpiresAt;
  } else {
    delete conv.containerId;
    delete conv.containerExpiresAt;
  }
  await persist(rootPath, conv);
}

/**
 * Pin a specific model to this conversation. Pass `undefined` to clear the
 * override so the conversation again tracks the global default.
 */
export async function setModel(rootPath: string, id: string, model: string | undefined): Promise<Conversation> {
  const conv = await load(rootPath, id);
  if (!conv) throw new Error(`Conversation not found: ${id}`);
  if (model) conv.model = model;
  else delete conv.model;
  await persist(rootPath, conv);
  return conv;
}

/**
 * Pin a reasoning-effort override on this conversation (#825). Pass `undefined`
 * to clear it so the conversation again inherits the global default. Mirrors
 * `setModel`.
 */
export async function setEffort(
  rootPath: string,
  id: string,
  effort: import('../../shared/tools/effort').Effort | undefined,
): Promise<Conversation> {
  const conv = await load(rootPath, id);
  if (!conv) throw new Error(`Conversation not found: ${id}`);
  if (effort) conv.effort = effort;
  else delete conv.effort;
  await persist(rootPath, conv);
  return conv;
}

/**
 * Replace a conversation's entire message array (used by `/compact`, #824, to
 * seed a fresh conversation with a summary + the retained recent turns).
 * Re-persists the whole JSON like every other mutation; no graph re-projection
 * since the conversation subject's triples don't depend on message content.
 */
export async function replaceMessages(
  rootPath: string,
  id: string,
  messages: ConversationMessage[],
): Promise<Conversation> {
  const conv = await load(rootPath, id);
  if (!conv) throw new Error(`Conversation not found: ${id}`);
  conv.messages = messages;
  await persist(rootPath, conv);
  return conv;
}

export async function load(rootPath: string, id: string): Promise<Conversation | null> {
  try {
    const data = await fs.readFile(convPath(rootPath, id), 'utf-8');
    return migrateOnLoad(JSON.parse(data) as Conversation);
  } catch {
    return null;
  }
}

/**
 * Normalize a persisted conversation document on load. Pre-#503 the status
 * set was {active, resolved, abandoned} with `resolvedAt` capturing the
 * resolve time. Both terminal states collapse to `archived`; we lift any
 * `resolvedAt` into `archivedAt` so we don't lose the timestamp. In-memory
 * only — we don't rewrite the JSON until the next `persist()` for that
 * conversation, so this is safe to re-run.
 */
function migrateOnLoad(raw: Conversation & { resolvedAt?: string }): Conversation {
  const status = raw.status as ConversationStatus | 'resolved' | 'abandoned';
  if (status === 'resolved' || status === 'abandoned') {
    raw.status = 'archived';
    if (!raw.archivedAt && raw.resolvedAt) raw.archivedAt = raw.resolvedAt;
    delete raw.resolvedAt;
  }
  return raw;
}

export async function listAll(rootPath: string): Promise<Conversation[]> {
  const dir = convDir(rootPath);
  try {
    const files = await fs.readdir(dir);
    const convs: Conversation[] = [];
    for (const file of files) {
      // Skip the `_ui.json` UI-state file (and any other underscore-prefixed
      // sibling files we add later) so they don't get parsed as conversations.
      if (!file.endsWith('.json') || file.startsWith('_')) continue;
      try {
        const data = await fs.readFile(path.join(dir, file), 'utf-8');
        convs.push(migrateOnLoad(JSON.parse(data) as Conversation));
      } catch { /* skip malformed */ }
    }
    convs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return convs;
  } catch {
    return [];
  }
}

export async function listActive(rootPath: string): Promise<Conversation[]> {
  const all = await listAll(rootPath);
  return all.filter(c => c.status === 'active');
}

// ── Tool-window UI state ───────────────────────────────────────────────────

function uiStatePath(rootPath: string): string {
  return path.join(convDir(rootPath), '_ui.json');
}

export async function loadUIState(rootPath: string): Promise<ConversationsUIState> {
  try {
    const raw = await fs.readFile(uiStatePath(rootPath), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ConversationsUIState>;
    return {
      visible: typeof parsed.visible === 'boolean' ? parsed.visible : DEFAULT_UI_STATE.visible,
      height: typeof parsed.height === 'number' && parsed.height > 0 ? parsed.height : DEFAULT_UI_STATE.height,
      activeTabId: typeof parsed.activeTabId === 'string' ? parsed.activeTabId : null,
    };
  } catch {
    return { ...DEFAULT_UI_STATE };
  }
}

export async function saveUIState(rootPath: string, state: ConversationsUIState): Promise<void> {
  const dir = convDir(rootPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(uiStatePath(rootPath), JSON.stringify(state, null, 2), 'utf-8');
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function persist(rootPath: string, conv: Conversation): Promise<void> {
  const dir = convDir(rootPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(convPath(rootPath, conv.id), JSON.stringify(conv, null, 2), 'utf-8');
}

// ── Graph Integration ──────────────────────────────────────────────────────

function convUri(id: string): string {
  return `${THOUGHT}conversation/${id}`;
}

/** Predicates a conversation subject can hold. Listed so we can drop them
 *  cleanly before re-projecting (so historical bad-shape triples from
 *  before #350 don't linger as dust alongside the corrected ones). */
const CONVERSATION_PREDICATES = [
  'conversationStatus',
  'startedAt',
  'archivedAt',
  // Pre-#503 predicate; still listed so re-projecting an old graph
  // scrubs the legacy timestamp before writing the new shape.
  'resolvedAt',
  'trigger',
  'contextNote',
  'conversationContent',
];

function clearConversationTriples(rootPath: string, uri: string): void {
  const ctx = projectContext(rootPath);
  graph.removeMatchingTriples(ctx, uri, 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type');
  for (const p of CONVERSATION_PREDICATES) {
    graph.removeMatchingTriples(ctx, uri, `${THOUGHT}${p}`);
  }
  // dc:created lands when a conversation is filed as a source — drop it
  // for symmetry so re-projection of a resolved conversation produces
  // exactly one creation timestamp.
  graph.removeMatchingTriples(ctx, uri, 'http://purl.org/dc/terms/created');
}

function writeConversationToGraph(rootPath: string, conv: Conversation): void {
  const uri = convUri(conv.id);
  const ctx = projectContext(rootPath);
  // contextNote needs a real IRI, not the raw `notes/foo.md` string —
  // the prior shape (#350) made downstream joins against
  // minerva:relativePath silently mismatch.
  const contextNoteIri = conv.contextBundle.notePath
    ? graph.noteUriFor(ctx, conv.contextBundle.notePath)
    : null;
  clearConversationTriples(rootPath, uri);
  const turtle = `
    @prefix thought: <${THOUGHT}> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

    <${uri}> a thought:Conversation ;
      thought:conversationStatus thought:active ;
      thought:startedAt "${conv.startedAt}"^^xsd:dateTime
      ${conv.triggerNodeUri ? `; thought:trigger <${conv.triggerNodeUri}>` : ''}
      ${contextNoteIri ? `; thought:contextNote <${contextNoteIri}>` : ''} .
  `;
  graph.parseIntoStore(ctx, turtle);
}

function updateConversationInGraph(rootPath: string, conv: Conversation): void {
  const uri = convUri(conv.id);
  const turtle = `
    @prefix thought: <${THOUGHT}> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

    <${uri}> thought:conversationStatus thought:${conv.status}
      ${conv.archivedAt ? `; thought:archivedAt "${conv.archivedAt}"^^xsd:dateTime` : ''} .
  `;
  graph.parseIntoStore(projectContext(rootPath), turtle);
}

async function fileAsSource(rootPath: string, conv: Conversation): Promise<void> {
  const uri = convUri(conv.id);
  const transcript = conv.messages
    .map(m => `[${m.role}] ${m.content}`)
    .join('\n\n');

  const turtle = `
    @prefix thought: <${THOUGHT}> .
    @prefix dc: <http://purl.org/dc/terms/> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

    <${uri}> a thought:Source ;
      thought:conversationContent "${escapeTurtleLiteral(transcript)}" ;
      dc:created "${conv.startedAt}"^^xsd:dateTime .
  `;
  const ctx = projectContext(rootPath);
  graph.parseIntoStore(ctx, turtle);
  await graph.persistGraph(ctx);
}
