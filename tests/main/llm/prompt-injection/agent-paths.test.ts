/**
 * @vitest-environment node
 *
 * No path a model chooses reaches `.minerva/` (#2453).
 *
 * `.minerva/` holds conversation transcripts, `secrets.json`, `config.json`,
 * the proposal store, types and templates. Every listing, index and search
 * walk skips it, but until #2453 nothing applied that rule to a SINGLE path
 * handed to a tool: `read_note({ relative_path: ".minerva/secrets.json" })`
 * returned the file, and `propose_notes` accepted a target under it. A planted
 * instruction in a shared note is all it takes to ask.
 *
 * Same harness as `prompt-injection.test.ts`: the real `completeWithTools`
 * loop and tool registry, the SDK mocked at the client so the "model" is a
 * script that obeys. For every path-taking tool and every spelling —
 * `.minerva/…`, `./.minerva/…`, `notes/../.minerva/…`, `.MINERVA/…` (the
 * default macOS volume is case-insensitive), a directory symlink and a file
 * symlink inside the root that land in `.minerva/`, and URL-encoded forms
 * (no tool decodes, so `%2E` is a literal name and must simply not resolve) —
 * it asserts:
 *
 *   - the call is an error;
 *   - no canary from the three target files reaches ANY model request;
 *   - no draft was emitted and no proposal was filed;
 *
 * and then that ordinary notes, including one whose name merely contains
 * "minerva", still read and propose normally.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { silenceLogTags } from '../../../helpers/quiet-logs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { useGraphProject } from '../../../helpers/temp-project';

const { streamMock, getSettingsMock } = vi.hoisted(() => ({
  streamMock: vi.fn(),
  getSettingsMock: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { stream: streamMock };
  },
}));
vi.mock('../../../../src/main/llm/settings', () => ({ getSettings: getSettingsMock }));
// No MCP servers: `mcp_call` takes no thoughtbase path and is out of scope here.
vi.mock('../../../../src/main/mcp-servers/config-store', () => ({
  getStoredServers: vi.fn(async () => []),
  addStoredServer: vi.fn(),
  updateStoredServer: vi.fn(),
  setStoredServerEnabled: vi.fn(),
  removeStoredServer: vi.fn(),
}));

import { completeWithTools, type ExecutedToolCall, type StreamCallbacks } from '../../../../src/main/llm/index';
import { listProposals } from '../../../../src/main/llm/proposal-persistence';
import * as graph from '../../../../src/main/graph/index';
import { registerTool, unregisterTool } from '../../../../src/shared/tools/registry';
import type { ThinkingToolDef } from '../../../../src/shared/tools/types';

interface ToolCall { name: string; input: Record<string, unknown> }

function message(stop: 'tool_use' | 'end_turn', content: unknown[]): Anthropic.Message {
  return {
    id: `msg-${crypto.randomUUID()}`,
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-6',
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 } as unknown as Anthropic.Usage,
    content,
  } as unknown as Anthropic.Message;
}

/** Script the model: one turn of `calls`, then stop. Returns every request sent. */
function scriptModel(calls: ToolCall[]): unknown[] {
  const turns = [
    message('tool_use', calls.map((c, i) => ({ type: 'tool_use', id: `tu-${i}`, name: c.name, input: c.input }))),
    message('end_turn', [{ type: 'text', text: 'Done.', citations: null }]),
  ];
  const requests: unknown[] = [];
  let i = 0;
  streamMock.mockImplementation((args: { system: unknown; messages: unknown }) => {
    requests.push(JSON.parse(JSON.stringify({ system: args.system, messages: args.messages })));
    const turn = turns[Math.min(i++, turns.length - 1)]!;
    return { on: () => undefined, finalMessage: async () => turn };
  });
  return requests;
}

const CANARY = {
  conversation: `CANARY-2453-CONVERSATION-${crypto.randomUUID()}`,
  secrets: `CANARY-2453-SECRETS-${crypto.randomUUID()}`,
  config: `CANARY-2453-CONFIG-${crypto.randomUUID()}`,
  nodeModules: `CANARY-2453-NODE-MODULES-${crypto.randomUUID()}`,
};
const ALL_CANARIES = Object.values(CANARY);

/** The three targets the issue names, relative to `.minerva/`. */
const TARGETS = [
  ['conversation transcript', 'conversations/conv-old.json'],
  ['secrets.json', 'secrets.json'],
  ['config.json', 'config.json'],
] as const;

/** Every spelling of `.minerva/<t>` under test. `notes/state` is an in-root
 *  directory symlink to `.minerva/` (containment allows it, by design). */
function spellings(t: string): string[] {
  return [
    `.minerva/${t}`,
    `./.minerva/${t}`,
    `notes/../.minerva/${t}`,
    `.MINERVA/${t}`,
    `.Minerva/${t}`,
    `notes/state/${t}`,
    `.minerva\\${t}`,
  ];
}

/** URL-encoded forms. Nothing decodes them, so each is a literal (missing)
 *  name: refused or not found, never the file. Read tools only — as a write
 *  TARGET, `%2Eminerva/x.md` is an ordinary, visible folder name. */
function encoded(t: string): string[] {
  return [`%2Eminerva/${t}`, `%2eminerva%2F${t}`, `.minerva%2F${t}`, `notes%2F..%2F.minerva%2F${t}`];
}

/** The read tools, with `p` in their path argument. */
function readCalls(p: string): ToolCall[] {
  return [
    ...fileReadCalls(p),
    { name: 'search_related', input: { relative_path: p } },
  ];
}

/** The tools that open `p` from disk. */
function fileReadCalls(p: string): ToolCall[] {
  return [
    { name: 'read_note', input: { relative_path: p } },
    { name: 'fetch_properties', input: { relative_path: p } },
    { name: 'run_skill', input: { skillId: SKILL.id, notePath: p } },
  ];
}

function targetCalls(p: string): ToolCall[] {
  const md = p.endsWith('.md') ? p : `${p}.md`;
  return [
    ...readCalls(p),
    { name: 'propose_note_body', input: { note: 'x', edits: [{ relative_path: p, content: '# pwned\n' }] } },
    { name: 'propose_note_body', input: { note: 'x', edits: [{ relative_path: md, content: '# pwned\n' }] } },
    { name: 'propose_note_delete', input: { paths: [p] } },
    { name: 'propose_note_delete', input: { paths: [md] } },
    { name: 'set_properties', input: { note: 'x', updates: [{ relativePath: p, properties: { status: 'pwned' } }] } },
    { name: 'propose_note_types', input: { note: 'x', assignments: [{ relativePath: p, typeId: 'idea' }] } },
    { name: 'propose_notes', input: { note: 'x', payloads: [{ kind: 'note', relativePath: md, content: '# pwned\n' }] } },
    { name: 'propose_notes', input: { note: 'x', payloads: [{ kind: 'note', relativePath: p, content: '{"pwned":true}\n' }] } },
    { name: 'propose_note_move', input: { moves: [{ path: p, destFolder: 'notes' }] } },
    { name: 'propose_note_rename', input: { renames: [{ path: p, newName: 'stolen.md' }] } },
    { name: 'propose_reorganization', input: { operations: [{ path: p, newPath: 'notes/stolen.md' }] } },
    { name: 'propose_reorganization', input: { operations: [{ path: 'notes/ordinary.md', newPath: md }] } },
    ...folderCalls(p),
  ];
}

/** Folder tools on `p`'s containing folder, when that folder is itself inside
 *  `.minerva/` (for `.minerva/secrets.json` it is the root, covered below). */
function folderCalls(p: string): ToolCall[] {
  const dir = path.posix.dirname(p.replaceAll('\\', '/'));
  if (dir === '.' || dir === 'notes') return [];
  return [
    { name: 'propose_folder_move', input: { moves: [{ path: dir, newPath: 'notes/stolen' }] } },
    { name: 'propose_folder_move', input: { moves: [{ path: 'notes', newPath: `${dir}/notes` }] } },
    { name: 'propose_folder_delete', input: { paths: [dir] } },
  ];
}

/** Destinations INTO `.minerva/`, from an ordinary note or folder. */
const INTO_MINERVA: ToolCall[] = [
  { name: 'propose_note_move', input: { moves: [{ path: 'notes/ordinary.md', destFolder: '.minerva/types' }] } },
  { name: 'propose_note_move', input: { moves: [{ path: 'notes/ordinary.md', destFolder: 'notes/state' }] } },
  { name: 'propose_note_rename', input: { renames: [{ path: 'notes/ordinary.md', newName: '.hidden.md' }] } },
  { name: 'propose_notes', input: { note: 'x', payloads: [{ kind: 'note', relativePath: '.minerva/types/evil.md', content: '---\nid: evil\n---\n' }] } },
  { name: 'propose_notes', input: { note: 'x', payloads: [{ kind: 'note', relativePath: 'notes/state/templates/evil.md', content: '# evil\n' }] } },
  { name: 'propose_notes', input: { note: 'x', payloads: [{ kind: 'note', relativePath: '.git/hooks/pre-commit', content: 'rm -rf ~\n' }] } },
  { name: 'propose_notes', input: { note: 'x', payloads: [{ kind: 'note', relativePath: 'NODE_MODULES/pkg/x.md', content: '# x\n' }] } },
  { name: 'propose_folder_move', input: { moves: [{ path: 'notes', newPath: '.minerva/notes' }] } },
  { name: 'propose_folder_delete', input: { paths: ['.minerva', 'notes/state', '.minerva/conversations', '.MINERVA', './.minerva', 'notes/../.minerva'] } },
  { name: 'propose_folder_move', input: { moves: [{ path: '.minerva', newPath: 'notes/minerva-state' }] } },
  { name: 'propose_folder_move', input: { moves: [{ path: 'notes/state', newPath: 'notes/minerva-state' }] } },
  { name: 'propose_folder_move', input: { moves: [{ path: 'notes', newPath: 'notes/state/notes' }] } },
  // The root itself — deleting or moving it would take `.minerva/` along.
  { name: 'propose_folder_delete', input: { paths: ['.', './', 'notes/..'] } },
  { name: 'propose_folder_move', input: { moves: [{ path: '.', newPath: 'notes/everything' }] } },
  // A source id is spliced into `.minerva/sources/<id>/…` by the tool itself.
  { name: 'read_source', input: { source_id: '../conversations' } },
  { name: 'read_source', input: { source_id: '..' } },
  { name: 'propose_claims', input: { note: 'x', sourceId: '../conversations', claims: [{ text: 'x', kind: 'claim', quote: 'x' }] } },
  { name: 'propose_source_properties', input: { note: 'x', sourceId: '../../notes', abstract: 'pwned' } },
  // Case folding: the default macOS volume opens node_modules for NODE_MODULES.
  { name: 'read_note', input: { relative_path: 'NODE_MODULES/pkg/README.md' } },
  { name: 'read_note', input: { relative_path: 'node_modules/pkg/README.md' } },
  { name: 'read_note', input: { relative_path: 'notes/deps/pkg/README.md' } },
];

const SKILL: ThinkingToolDef = {
  id: 'test.agent-path-fixture',
  name: 'Agent Path Fixture',
  category: 'analysis',
  description: 'Summarize a note.',
  longDescription: 'Fixture skill that reads one note.',
  context: ['fullNote'],
  outputMode: 'newNote',
  buildPrompt: (ctx) => `Summarize ${ctx.fullNotePath}:\n${ctx.fullNoteContent}`,
};

// Expected: these tests drive failure paths the code logs (#2390).
silenceLogTags('conversation');

describe('agent-chosen paths never reach .minerva/ (#2453)', () => {
  const project = useGraphProject('minerva-agent-paths-');

  beforeEach(async () => {
    streamMock.mockReset();
    getSettingsMock.mockResolvedValue({
      providers: { anthropic: { apiKey: 'fake' } },
      model: 'claude-sonnet-4-6',
      web: { enabled: false, allowedDomains: [], blockedDomains: [] },
    });
    registerTool(SKILL);

    const root = project.root;
    const m = path.join(root, '.minerva');
    fs.mkdirSync(path.join(m, 'conversations'), { recursive: true });
    fs.mkdirSync(path.join(m, 'types'), { recursive: true });
    fs.writeFileSync(path.join(m, 'conversations', 'conv-old.json'), JSON.stringify({ messages: [{ role: 'user', content: CANARY.conversation }] }));
    fs.writeFileSync(path.join(m, 'secrets.json'), JSON.stringify({ token: CANARY.secrets }));
    fs.writeFileSync(path.join(m, 'config.json'), JSON.stringify({ note: CANARY.config }));
    // `.md`-named copies, so the .md-only tools reach their path check with a
    // file that exists rather than stopping at "only .md notes".
    for (const t of TARGETS) fs.writeFileSync(path.join(m, `${t[1]}.md`), `# ${t[0]}\n\n${fs.readFileSync(path.join(m, t[1]), 'utf-8')}\n`);
    fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', 'pkg', 'README.md'), `# pkg\n\n${CANARY.nodeModules}\n`);

    fs.mkdirSync(path.join(root, 'notes'), { recursive: true });
    fs.writeFileSync(path.join(root, 'notes', 'ordinary.md'), '---\nstatus: draft\n---\n# Ordinary\n\nAn ordinary note.\n');
    fs.writeFileSync(path.join(root, 'notes', 'minerva-ideas.md'), '---\nstatus: seed\n---\n# Minerva ideas\n\nIdeas about the goddess of wisdom.\n');
    // In-root symlinks into `.minerva/` — `assertSafePath` allows both by design.
    fs.symlinkSync(m, path.join(root, 'notes', 'state'));
    fs.symlinkSync(path.join(m, 'secrets.json'), path.join(root, 'notes', 'innocent.json'));
    fs.symlinkSync(path.join(m, 'secrets.json.md'), path.join(root, 'notes', 'innocent.md'));
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(root, 'notes', 'deps'));

    await graph.indexAllNotes(project.ctx);
  });

  afterEach(() => {
    unregisterTool(SKILL.id);
  });

  async function run(calls: ToolCall[]) {
    const requests = scriptModel(calls);
    const drafts: Array<{ kind: string; draft: unknown }> = [];
    const capture = (kind: string) => (draft: unknown) => { drafts.push({ kind, draft }); };
    const callbacks: StreamCallbacks = {
      onChunk: () => undefined,
      onDraft: capture('notes'),
      onSourceDraft: capture('sources'),
      onPropertyDraft: capture('properties'),
      onSourcePropertyDraft: capture('source_properties'),
      onClaimsDraft: capture('claims'),
      onComputeDraft: capture('compute'),
      onRefactorDraft: capture('refactor'),
      onReorgDraft: capture('reorg'),
      onDeleteDraft: capture('delete'),
      onNoteBodyDraft: capture('note_body'),
    };
    const executed: ExecutedToolCall[] = [];
    await completeWithTools({
      system: 'sys',
      messages: [{ role: 'user', content: 'Tidy my notes.' }],
      toolContext: { rootPath: project.root, conversationId: 'conv-2453' },
      callbacks,
      onToolExecuted: (c) => executed.push(c),
    });
    return { requests, drafts, executed };
  }

  function expectAllRefused(executed: ExecutedToolCall[], calls: ToolCall[]) {
    expect(executed).toHaveLength(calls.length);
    const leaked = executed.filter((c) => !c.isError).map((c) => `${c.name} ${JSON.stringify(c.input)} → ${c.content.slice(0, 160)}`);
    expect(leaked).toEqual([]);
  }

  it.each(TARGETS)('%s: every tool refuses every spelling, and nothing leaks or is filed', async (_label, target) => {
    const calls = [
      ...spellings(target).flatMap(targetCalls),
      ...spellings(`${target}.md`).flatMap(targetCalls),
      ...encoded(target).flatMap(fileReadCalls),
      ...readCalls('notes/innocent.json'),
      ...targetCalls('notes/innocent.md'),
    ];
    const { requests, drafts, executed } = await run(calls);

    expectAllRefused(executed, calls);
    // A path the guard saw is refused BY the guard (or, for a `..` spelling,
    // by the parse-time traversal check three tools keep in front of it) —
    // not by a later accident such as a missing file or a non-.md name. The
    // encoded forms are the exception: literal names that do not exist.
    const byGuard = executed.filter((c) => !JSON.stringify(c.input).includes('%'));
    const notByGuard = byGuard.filter(
      (c) => !/Refused: |must not contain '\.\.'|Unsafe relativePath/.test(c.content),
    );
    expect(notByGuard.map((c) => `${c.name} ${JSON.stringify(c.input)} → ${c.content.slice(0, 160)}`)).toEqual([]);

    for (const req of requests) {
      const text = JSON.stringify(req);
      for (const canary of ALL_CANARIES) expect(text).not.toContain(canary);
    }
    expect(drafts).toEqual([]);
    expect(await listProposals(project.ctx)).toEqual([]);
  }, 60_000);

  it('targets INTO .minerva/, .git/ and node_modules/, and spliced source ids, are refused', async () => {
    const { requests, drafts, executed } = await run(INTO_MINERVA);
    expectAllRefused(executed, INTO_MINERVA);
    for (const req of requests) {
      const text = JSON.stringify(req);
      for (const canary of ALL_CANARIES) expect(text).not.toContain(canary);
    }
    expect(drafts).toEqual([]);
    expect(await listProposals(project.ctx)).toEqual([]);
    expect(fs.existsSync(path.join(project.root, '.minerva', 'types', 'evil.md'))).toBe(false);
  }, 60_000);

  it('ordinary notes — including notes/minerva-ideas.md — still read and propose normally', async () => {
    const calls: ToolCall[] = [
      { name: 'read_note', input: { relative_path: 'notes/minerva-ideas.md' } },
      { name: 'read_note', input: { relative_path: './notes/ordinary.md' } },
      { name: 'fetch_properties', input: { relative_path: 'notes/minerva-ideas.md' } },
      { name: 'run_skill', input: { skillId: SKILL.id, notePath: 'notes/minerva-ideas.md' } },
      { name: 'propose_note_body', input: { note: 'x', edits: [{ relative_path: 'notes/minerva-ideas.md', content: '# Minerva ideas\n\nMore.\n' }] } },
      { name: 'propose_notes', input: { note: 'x', payloads: [{ kind: 'note', relativePath: 'notes/minerva/more-ideas.md', content: '# More\n' }] } },
      { name: 'set_properties', input: { note: 'x', updates: [{ relativePath: 'notes/minerva-ideas.md', properties: { status: 'grown' } }] } },
      { name: 'propose_note_delete', input: { paths: ['notes/ordinary.md'] } },
      { name: 'propose_note_move', input: { moves: [{ path: 'notes/minerva-ideas.md', destFolder: 'archive' }] } },
    ];
    const { drafts, executed } = await run(calls);
    const failed = executed.filter((c) => c.isError).map((c) => `${c.name} → ${c.content.slice(0, 200)}`);
    expect(failed).toEqual([]);
    expect(executed[0]!.content).toContain('goddess of wisdom');
    expect(executed[1]!.content).toContain('An ordinary note.');
    expect(executed[2]!.content).toContain('"status": "seed"');
    expect(executed[3]!.content).toContain('goddess of wisdom');
    expect(new Set(drafts.map((d) => d.kind))).toEqual(new Set(['note_body', 'notes', 'properties', 'delete', 'refactor']));
  }, 60_000);
});
