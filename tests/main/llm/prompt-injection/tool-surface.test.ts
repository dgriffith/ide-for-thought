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
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NOTEBASE_TOOL_REGISTRY } from '../../../../src/main/llm/tools/registry';

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

  it('only the proposal helpers file proposals, and only as pending (proposeWrite)', () => {
    const filers = [...toolSourceFiles(), ...PROPOSAL_HELPERS].filter((rel) =>
      /\bproposeWrite\s*\(/.test(fs.readFileSync(path.join(REPO, rel), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '')),
    );
    expect(filers.sort()).toEqual([...PROPOSAL_HELPERS].sort());
  });
});
