/**
 * @vitest-environment node
 *
 * The LLM tool surface has no write, approve or trusted-context path (#2373).
 *
 * The runtime suite beside this one proves the CURRENT tools hold against a
 * compromised model. This is the static half, so the next tool can't quietly
 * change the answer:
 *
 *   1. Every dispatchable tool is classified. The list fails CLOSED: a new
 *      tool must be put in a class here, which is the moment to ask whether it
 *      reads, drafts, or does something neither of those covers.
 *   2. No module under `src/main/llm/tools/` — nor the two helpers that file
 *      proposals on a tool's behalf — takes anything but listing / stat from
 *      Node's `fs`, calls a filesystem or notebase write, approves or applies a proposal, or enters the approval engine's
 *      trusted context (which would switch the write guard off for whatever
 *      runs inside it). Filing a PENDING proposal via `proposeWrite` is the
 *      one mutation allowed, and only in those helpers.
 *   3. Every tool parameter shaped like a path is classified, and its tool
 *      calls the agent-path guard (`tools/agent-path.ts`) — so no path an
 *      agent chose reaches `.minerva/` (#2453). Fails closed both ways.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NOTEBASE_TOOL_REGISTRY } from '../../../../src/main/llm/tools/registry';
import { askUser } from '../../../../src/main/llm/tools/ask-user';
import type { ToolSpec } from '../../../../src/main/llm/provider/types';

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const TOOLS_DIR = path.join(REPO, 'src', 'main', 'llm', 'tools');
/** Helpers a tool calls to file PENDING proposals (propose_note_types, propose_object_type). */
const PROPOSAL_HELPERS = ['src/main/llm/infer-types.ts', 'src/main/llm/object-types.ts'];

type ToolClass =
  /** Reads the thoughtbase, the graph, the tables or the docs. */
  | 'read'
  /** Emits a draft for the review card, or files a PENDING proposal. */
  | 'propose'
  /** Calls a user-configured third-party MCP server (no confirmation gate, by design — #2028). */
  | 'external'
  /** Runs a stock/user skill as a sub-prompt; its output is drafts. */
  | 'skill'
  /** Round-trips a question to the user. */
  | 'interactive';

const CLASSIFIED: Record<string, ToolClass> = {
  search_notes: 'read',
  grep_notes: 'read',
  read_note: 'read',
  read_source: 'read',
  search_related: 'read',
  search_help: 'read',
  query_graph: 'read',
  list_notes: 'read',
  list_object_types: 'read',
  describe_graph_schema: 'read',
  describe_tables: 'read',
  query_sql: 'read',
  fetch_properties: 'read',
  propose_note_rename: 'propose',
  propose_note_move: 'propose',
  propose_reorganization: 'propose',
  propose_note_delete: 'propose',
  propose_folder_move: 'propose',
  propose_folder_delete: 'propose',
  propose_note_body: 'propose',
  propose_note_edits: 'propose',
  propose_notes: 'propose',
  propose_sources: 'propose',
  set_properties: 'propose',
  propose_source_properties: 'propose',
  propose_note_types: 'propose',
  propose_object_type: 'propose',
  propose_claims: 'propose',
  propose_compute: 'propose',
  mcp_call: 'external',
  run_skill: 'skill',
  ask_user: 'interactive',
};

/** What a tool may take from Node's `fs`: listing and stat-ing, never writing. */
const FS_READ_ONLY = new Set(['readdir', 'readFile', 'stat', 'lstat', 'realpath', 'access', 'Dirent', 'Stats']);

const FORBIDDEN: Array<[RegExp, string]> = [
  [/\.(writeFile|writeBinaryFile|appendFile|createFile|deleteFile|createFolder|deleteFolder|rename|copyItem|copyFile|cp|unlink|rm|rmdir|mkdir|symlink|truncate|chmod|open|createWriteStream)\(/, 'calls a filesystem write'],
  [/\b(approveProposal|rejectProposal|applyBundle|applyTurtle)\b/, 'approves or applies a proposal'],
  [/\b(withTrustedContext|enterTrustedContext)\b/, "enters the approval engine's trusted context"],
  [/\b(writeJsonFileAtomic\w*|saveType|ingestIdentifier|ingestUrl|ingestPdf\w*)\s*\(/, 'writes a store or ingests directly'],
];

const ALL_TOOLS: Record<string, ToolSpec> = {
  ...Object.fromEntries(Object.entries(NOTEBASE_TOOL_REGISTRY).map(([n, t]) => [n, t.definition])),
  ask_user: askUser.definition,
};

/** A parameter name that holds a thoughtbase path, or an id spliced into one. */
const PATH_SHAPED = /(path|paths|folder|folders|dir|file|files)$|^newName$|source_?id$/i;

/** Every path-shaped property name anywhere in a JSON schema (nested objects
 *  and array items included), as a dotted trail. */
function pathParams(schema: unknown, trail = ''): string[] {
  if (!schema || typeof schema !== 'object') return [];
  const s = schema as { properties?: Record<string, unknown>; items?: unknown };
  const out: string[] = [];
  for (const [k, v] of Object.entries(s.properties ?? {})) {
    const here = trail ? `${trail}.${k}` : k;
    if (PATH_SHAPED.test(k)) out.push(here);
    out.push(...pathParams(v, here));
  }
  if (s.items) out.push(...pathParams(s.items, `${trail}[]`));
  return out;
}

/**
 * Tools that take a path-shaped argument, the guard each calls, and the file
 * that calls it. `agentPath` = `assertAgentPath` (no hidden / ignored segment,
 * as spelled or after symlinks, inside the root); `bareSourceId` = one
 * segment, never a path, for an id Minerva splices into
 * `.minerva/sources/<id>/…` itself. No tool here is "by design" exempt:
 * `search_related`'s lookup is index-only, and it is guarded anyway.
 */
const PATH_GUARDED: Record<string, { guard: 'agentPath' | 'bareSourceId'; site: string }> = {
  read_note: { guard: 'agentPath', site: 'read-note.ts' },
  fetch_properties: { guard: 'agentPath', site: 'fetch-properties.ts' },
  search_related: { guard: 'agentPath', site: 'search-related.ts' },
  run_skill: { guard: 'agentPath', site: 'run-skill.ts' },
  propose_note_body: { guard: 'agentPath', site: 'propose-note-body.ts' },
  // Shares `readNoteForEdit` with propose_note_body, which is where the guard is.
  propose_note_edits: { guard: 'agentPath', site: 'propose-note-body.ts' },
  propose_notes: { guard: 'agentPath', site: 'propose-notes.ts' },
  propose_note_delete: { guard: 'agentPath', site: 'propose-note-delete.ts' },
  set_properties: { guard: 'agentPath', site: 'set-properties.ts' },
  propose_note_types: { guard: 'agentPath', site: 'propose-note-types.ts' },
  // move + rename share `runProposeRefactorBatch`, which checks both endpoints.
  propose_note_move: { guard: 'agentPath', site: '_shared.ts' },
  propose_note_rename: { guard: 'agentPath', site: '_shared.ts' },
  propose_reorganization: { guard: 'agentPath', site: 'propose-reorganization.ts' },
  propose_folder_move: { guard: 'agentPath', site: 'propose-folder-move.ts' },
  propose_folder_delete: { guard: 'agentPath', site: 'propose-folder-delete.ts' },
  read_source: { guard: 'bareSourceId', site: 'read-source.ts' },
  propose_claims: { guard: 'bareSourceId', site: 'propose-claims.ts' },
  propose_source_properties: { guard: 'bareSourceId', site: 'propose-source-properties.ts' },
};

function toolSourceFiles(): string[] {
  return fs
    .readdirSync(TOOLS_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.relative(REPO, path.join(TOOLS_DIR, f)));
}

describe('LLM tool surface: read, draft or propose — nothing else (#2373)', () => {
  it('every dispatchable tool is classified (fails closed on a new one)', () => {
    const names = [...Object.keys(NOTEBASE_TOOL_REGISTRY), 'ask_user'].sort();
    expect(names).toEqual(Object.keys(CLASSIFIED).sort());
  });

  it('no tool can approve: nothing in the surface is named like an approval', () => {
    const approvalish = Object.keys(CLASSIFIED).filter((n) => /approv|apply|accept|confirm|commit/i.test(n));
    expect(approvalish).toEqual([]);
  });

  it.each([...toolSourceFiles(), ...PROPOSAL_HELPERS])('%s has no write / approve / trusted-context path', (rel) => {
    const src = fs.readFileSync(path.join(REPO, rel), 'utf-8')
      // Comments describe the forbidden calls ("does NOT call proposeWrite"); only code counts.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const hits = FORBIDDEN.filter(([re]) => re.test(src)).map(([, why]) => why);
    for (const m of src.matchAll(/import\s*(type\s*)?\{([^}]*)\}\s*from\s*['"](node:)?fs(\/promises)?['"]/g)) {
      for (const name of m[2]!.split(',').map((n) => n.trim().split(/\s+as\s+/)[0]!).filter(Boolean)) {
        if (!FS_READ_ONLY.has(name)) hits.push(`imports ${name} from Node's fs`);
      }
    }
    expect(hits).toEqual([]);
  });

  // ── path arguments go through the agent-path guard (#2453) ────────────────
  //
  // A property whose NAME says it holds a path (or a source id Minerva splices
  // into one) is a door into `.minerva/`. Every tool with one must be listed
  // below with the guard it calls, and must call it; a tool listed here that
  // no longer takes a path must be removed. Both directions fail CLOSED, so a
  // new tool — or a new parameter on an old one — is the moment to route it
  // through `tools/agent-path.ts`. The runtime proof is `agent-paths.test.ts`.
  it('every path-shaped tool parameter is classified, and none is unclassified', () => {
    const withPaths = Object.fromEntries(
      Object.entries(ALL_TOOLS).map(([name, def]) => [name, pathParams(def.input_schema)]).filter(([, ps]) => ps.length > 0),
    );
    expect(Object.keys(withPaths).sort()).toEqual(Object.keys(PATH_GUARDED).sort());
  });

  it.each(Object.entries(PATH_GUARDED))('%s routes its path argument through the agent-path guard', (_name, { guard, site }) => {
    const src = fs.readFileSync(path.join(TOOLS_DIR, site), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const calls = guard === 'agentPath' ? /\bagentPath(Problem)?\s*\(/ : /\bbareSourceId\s*\(/;
    expect(src).toMatch(/from '\.\/agent-path'/);
    expect(src).toMatch(calls);
  });

  it('only the proposal helpers file proposals, and only as pending (proposeWrite)', () => {
    const filers = [...toolSourceFiles(), ...PROPOSAL_HELPERS].filter((rel) =>
      /\bproposeWrite\s*\(/.test(fs.readFileSync(path.join(REPO, rel), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '')),
    );
    expect(filers.sort()).toEqual([...PROPOSAL_HELPERS].sort());
  });
});
