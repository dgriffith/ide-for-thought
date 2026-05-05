import fs from 'node:fs/promises';
import path from 'node:path';
import * as graph from '../graph/index';
import { projectContext, type ProjectContext } from '../project-context-types';
import type {
  Conversation,
  ConversationMessage,
  ContextBundle,
  ConversationStatus,
  ConversationsUIState,
} from '../../shared/types';

const DEFAULT_UI_STATE: ConversationsUIState = {
  visible: false,
  height: 320,
  activeTabId: null,
};

const THOUGHT = 'https://minerva.dev/ontology/thought#';
let conversationsDir: string | null = null;
let activeRootPath: string | null = null;

export function initConversations(rootPath: string): void {
  conversationsDir = path.join(rootPath, '.minerva', 'conversations');
  activeRootPath = rootPath;
}

/**
 * Re-project every persisted conversation into the graph. Called once
 * during project init: `writeConversationToGraph` clears prior triples
 * for the subject before re-adding, so historical bad-shape triples
 * (the #350 relative-path-as-IRI bug) get scrubbed and replaced with
 * the corrected IRI form. Cheap: small JSON files, in-memory rdflib.
 */
export async function reindexAllConversations(): Promise<void> {
  if (!conversationsDir) return;
  let files: string[];
  try {
    files = await fs.readdir(conversationsDir);
  } catch { return; /* no conversations yet */ }
  for (const file of files) {
    // Skip the `_ui.json` UI-state file (and any other underscore-prefixed
    // sibling files we add later) so they don't get parsed as conversations
    // — without this guard the JSON parses but lacks `contextBundle`, and
    // writeConversationToGraph dereferences it.
    if (!file.endsWith('.json') || file.startsWith('_')) continue;
    try {
      const data = await fs.readFile(path.join(conversationsDir, file), 'utf-8');
      const conv = migrateOnLoad(JSON.parse(data) as Conversation);
      writeConversationToGraph(conv);
      if (conv.status !== 'active') {
        // Mirror the live status so archive doesn't get dropped on reload.
        updateConversationInGraph(conv);
      }
    } catch (err) {
      console.warn(`[conversation] reindex skipped ${file}:`, err);
    }
  }
}

function activeCtx(): ProjectContext {
  if (!activeRootPath) throw new Error('Conversations not initialized — no project open');
  return projectContext(activeRootPath);
}

function ensureDir(): string {
  if (!conversationsDir) throw new Error('Conversations not initialized — no project open');
  return conversationsDir;
}

function convPath(id: string): string {
  return path.join(ensureDir(), `${id}.json`);
}

function generateId(): string {
  return `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── CRUD ───────────────────────────────────────────────────────────────────

export async function create(
  contextBundle: ContextBundle,
  triggerNodeUri?: string,
  options?: { systemPrompt?: string; model?: string },
): Promise<Conversation> {
  const dir = ensureDir();
  await fs.mkdir(dir, { recursive: true });

  const now = new Date().toISOString();
  const conv: Conversation = {
    id: generateId(),
    triggerNodeUri,
    contextBundle,
    messages: [],
    status: 'active',
    startedAt: now,
  };
  if (options?.systemPrompt) conv.systemPrompt = options.systemPrompt;
  if (options?.model) conv.model = options.model;

  await persist(conv);
  writeConversationToGraph(conv);
  return conv;
}

export async function appendMessage(
  id: string,
  role: ConversationMessage['role'],
  content: string,
  extra?: Partial<Pick<ConversationMessage, 'citations'>>,
): Promise<Conversation> {
  const conv = await load(id);
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
  conv.messages.push(message);
  await persist(conv);
  return conv;
}

/**
 * Single terminal state. Closing a tab archives the conversation; the
 * `thought:Source` filing is preserved (provenance is still useful even
 * with one archive state). Idempotent — archiving an already-archived
 * conversation no-ops past the load.
 */
export async function archive(id: string): Promise<Conversation> {
  const conv = await load(id);
  if (!conv) throw new Error(`Conversation not found: ${id}`);
  if (conv.status === 'archived') return conv;

  conv.status = 'archived';
  conv.archivedAt = new Date().toISOString();

  await persist(conv);
  updateConversationInGraph(conv);
  await fileAsSource(conv);
  return conv;
}

/**
 * Pin a specific model to this conversation. Pass `undefined` to clear the
 * override so the conversation again tracks the global default.
 */
export async function setModel(id: string, model: string | undefined): Promise<Conversation> {
  const conv = await load(id);
  if (!conv) throw new Error(`Conversation not found: ${id}`);
  if (model) conv.model = model;
  else delete conv.model;
  await persist(conv);
  return conv;
}

export async function load(id: string): Promise<Conversation | null> {
  try {
    const data = await fs.readFile(convPath(id), 'utf-8');
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

export async function listAll(): Promise<Conversation[]> {
  // Tolerate "no project open" — the renderer's conversations panel
  // calls this on app mount before any project has been acquired, and
  // the natural answer is "no conversations" rather than an error.
  if (!conversationsDir) return [];
  try {
    const files = await fs.readdir(conversationsDir);
    const convs: Conversation[] = [];
    for (const file of files) {
      // Skip the `_ui.json` UI-state file (and any other underscore-prefixed
      // sibling files we add later) so they don't get parsed as conversations.
      if (!file.endsWith('.json') || file.startsWith('_')) continue;
      try {
        const data = await fs.readFile(path.join(conversationsDir, file), 'utf-8');
        convs.push(migrateOnLoad(JSON.parse(data) as Conversation));
      } catch { /* skip malformed */ }
    }
    convs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return convs;
  } catch {
    return [];
  }
}

export async function listActive(): Promise<Conversation[]> {
  const all = await listAll();
  return all.filter(c => c.status === 'active');
}

// ── Tool-window UI state ───────────────────────────────────────────────────

function uiStatePath(): string {
  return path.join(ensureDir(), '_ui.json');
}

export async function loadUIState(): Promise<ConversationsUIState> {
  if (!conversationsDir) return { ...DEFAULT_UI_STATE };
  try {
    const raw = await fs.readFile(uiStatePath(), 'utf-8');
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

export async function saveUIState(state: ConversationsUIState): Promise<void> {
  const dir = ensureDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(uiStatePath(), JSON.stringify(state, null, 2), 'utf-8');
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function persist(conv: Conversation): Promise<void> {
  const dir = ensureDir();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(convPath(conv.id), JSON.stringify(conv, null, 2), 'utf-8');
}

// ── Graph Integration ──────────────────────────────────────────────────────

function convUri(id: string): string {
  return `${THOUGHT}conversation/${id}`;
}

function escapeTurtle(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
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

function clearConversationTriples(uri: string): void {
  const ctx = activeCtx();
  graph.removeMatchingTriples(ctx, uri, 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type');
  for (const p of CONVERSATION_PREDICATES) {
    graph.removeMatchingTriples(ctx, uri, `${THOUGHT}${p}`);
  }
  // dc:created lands when a conversation is filed as a source — drop it
  // for symmetry so re-projection of a resolved conversation produces
  // exactly one creation timestamp.
  graph.removeMatchingTriples(ctx, uri, 'http://purl.org/dc/terms/created');
}

function writeConversationToGraph(conv: Conversation): void {
  const uri = convUri(conv.id);
  const ctx = activeCtx();
  // contextNote needs a real IRI, not the raw `notes/foo.md` string —
  // the prior shape (#350) made downstream joins against
  // minerva:relativePath silently mismatch.
  const contextNoteIri = conv.contextBundle.notePath
    ? graph.noteUriFor(ctx, conv.contextBundle.notePath)
    : null;
  clearConversationTriples(uri);
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

function updateConversationInGraph(conv: Conversation): void {
  const uri = convUri(conv.id);
  const turtle = `
    @prefix thought: <${THOUGHT}> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

    <${uri}> thought:conversationStatus thought:${conv.status}
      ${conv.archivedAt ? `; thought:archivedAt "${conv.archivedAt}"^^xsd:dateTime` : ''} .
  `;
  graph.parseIntoStore(activeCtx(), turtle);
}

async function fileAsSource(conv: Conversation): Promise<void> {
  const uri = convUri(conv.id);
  const transcript = conv.messages
    .map(m => `[${m.role}] ${m.content}`)
    .join('\n\n');

  const turtle = `
    @prefix thought: <${THOUGHT}> .
    @prefix dc: <http://purl.org/dc/terms/> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

    <${uri}> a thought:Source ;
      thought:conversationContent "${escapeTurtle(transcript)}" ;
      dc:created "${conv.startedAt}"^^xsd:dateTime .
  `;
  const ctx = activeCtx();
  graph.parseIntoStore(ctx, turtle);
  await graph.persistGraph(ctx);
}
