import fs from 'node:fs/promises';
import path from 'node:path';
import * as graph from '../graph/index';
import { projectContext, type ProjectContext } from '../project-context-types';
import type { Conversation, ConversationMessage, ContextBundle, ConversationStatus } from '../../shared/types';

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
    if (!file.endsWith('.json')) continue;
    try {
      const data = await fs.readFile(path.join(conversationsDir, file), 'utf-8');
      const conv = JSON.parse(data) as Conversation;
      await writeConversationToGraph(conv);
      if (conv.status !== 'active') {
        // Mirror the live status so resolve/abandon don't get dropped on reload.
        await updateConversationInGraph(conv);
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
  await writeConversationToGraph(conv);
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

export async function resolve(id: string): Promise<Conversation> {
  return setStatus(id, 'resolved');
}

export async function abandon(id: string): Promise<Conversation> {
  return setStatus(id, 'abandoned');
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
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function listAll(): Promise<Conversation[]> {
  const dir = ensureDir();
  try {
    const files = await fs.readdir(dir);
    const convs: Conversation[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const data = await fs.readFile(path.join(dir, file), 'utf-8');
        convs.push(JSON.parse(data));
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

// ── Helpers ────────────────────────────────────────────────────────────────

async function setStatus(id: string, status: ConversationStatus): Promise<Conversation> {
  const conv = await load(id);
  if (!conv) throw new Error(`Conversation not found: ${id}`);

  conv.status = status;
  if (status === 'resolved') {
    conv.resolvedAt = new Date().toISOString();
  }

  await persist(conv);
  await updateConversationInGraph(conv);

  // On resolve, store as a thought:Source in the graph for provenance
  if (status === 'resolved') {
    await fileAsSource(conv);
  }

  return conv;
}

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

async function writeConversationToGraph(conv: Conversation): Promise<void> {
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

async function updateConversationInGraph(conv: Conversation): Promise<void> {
  const uri = convUri(conv.id);
  const statusMap: Record<ConversationStatus, string> = {
    active: 'active',
    resolved: 'resolved',
    abandoned: 'abandonedConversation',
  };
  const turtle = `
    @prefix thought: <${THOUGHT}> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

    <${uri}> thought:conversationStatus thought:${statusMap[conv.status]}
      ${conv.resolvedAt ? `; thought:resolvedAt "${conv.resolvedAt}"^^xsd:dateTime` : ''} .
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
