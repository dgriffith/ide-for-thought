/**
 * @vitest-environment node
 *
 * The LLM tool surface has no write, approve or trusted-context path (#2373).
 *
 * The runtime suite beside this one proves the CURRENT tools hold against a
 * compromised model. This is the static half, so the next tool can't quietly
 * change the answer:
 *
 *   1. Every dispatchable tool is classified. Since #2628 the class is part of
 *      registering a tool (`tools/registry.ts`, `tool-registry.ts`): a tool
 *      can't register without one, which is the moment to ask whether it
 *      reads, drafts, or does something neither of those covers. This reads
 *      the classes from the registry.
 *   2. No module under `src/main/llm/tools/` — nor the two helpers that file
 *      proposals on a tool's behalf — takes anything but listing / stat from
 *      Node's `fs`, calls a filesystem or notebase write, approves or applies a proposal, or enters the approval engine's
 *      trusted context (which would switch the write guard off for whatever
 *      runs inside it). Filing a PENDING proposal via `proposeWrite` is the
 *      one mutation allowed, and only in those helpers.
 *   3. Every tool parameter shaped like a path is classified, and its tool
 *      calls the agent-path guard (`tools/agent-path.ts`) — so no path an
 *      agent chose reaches `.minerva/` (#2453). The guard is declared at
 *      registration, which refuses a path parameter without one (and a guard
 *      without a path); this checks the declared site really calls it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TOOL_REGISTRATIONS } from '../../../../src/main/llm/tools/registry';
import { defineToolRegistry, pathParams, type ToolClass } from '../../../../src/main/llm/tools/tool-registry';
import { readNote } from '../../../../src/main/llm/tools/read-note';
import { searchNotes } from '../../../../src/main/llm/tools/search-notes';

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const TOOLS_DIR = path.join(REPO, 'src', 'main', 'llm', 'tools');
/** Helpers a tool calls to file PENDING proposals (propose_note_types, propose_object_type). */
const PROPOSAL_HELPERS = ['src/main/llm/infer-types.ts', 'src/main/llm/object-types.ts'];

const CLASSIFIED: Record<string, ToolClass> = Object.fromEntries(
  Object.entries(TOOL_REGISTRATIONS).map(([name, r]) => [name, r.class]),
);

/** What a tool may take from Node's `fs`: listing and stat-ing, never writing. */
const FS_READ_ONLY = new Set(['readdir', 'readFile', 'stat', 'lstat', 'realpath', 'access', 'Dirent', 'Stats']);

const FORBIDDEN: Array<[RegExp, string]> = [
  [/\.(writeFile|writeBinaryFile|appendFile|createFile|deleteFile|createFolder|deleteFolder|rename|copyItem|copyFile|cp|unlink|rm|rmdir|mkdir|symlink|truncate|chmod|open|createWriteStream)\(/, 'calls a filesystem write'],
  [/\b(approveProposal|rejectProposal|applyBundle|applyTurtle)\b/, 'approves or applies a proposal'],
  [/\b(withTrustedContext|enterTrustedContext)\b/, "enters the approval engine's trusted context"],
  [/\b(writeJsonFileAtomic\w*|saveType|ingestIdentifier|ingestUrl|ingestPdf\w*)\s*\(/, 'writes a store or ingests directly'],
];

/** Each path-taking tool's declared guard, from its registration. */
const PATH_GUARDED = Object.fromEntries(
  Object.entries(TOOL_REGISTRATIONS).flatMap(([name, r]) => (r.pathGuard ? [[name, r.pathGuard] as const] : [])),
);

function toolSourceFiles(): string[] {
  return fs
    .readdirSync(TOOLS_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.relative(REPO, path.join(TOOLS_DIR, f)));
}

describe('LLM tool surface: read, draft or propose — nothing else (#2373)', () => {
  it('every registered tool has a class from the closed set', () => {
    const CLASSES: readonly ToolClass[] = ['read', 'propose', 'external', 'skill', 'interactive'];
    expect(Object.keys(CLASSIFIED).length).toBeGreaterThan(30);
    expect(Object.entries(CLASSIFIED).filter(([, c]) => !CLASSES.includes(c))).toEqual([]);
  });

  it('registration refuses a path parameter without a guard, a guard without a path, and a duplicate', () => {
    expect(() => defineToolRegistry([{ tool: readNote, class: 'read' }])).toThrow(/takes a path .* no pathGuard/);
    expect(() => defineToolRegistry([{ tool: searchNotes, class: 'read', pathGuard: { guard: 'agentPath', site: 'x.ts' } }])).toThrow(/takes no path-shaped parameter/);
    expect(() => defineToolRegistry([{ tool: searchNotes, class: 'read' }, { tool: searchNotes, class: 'read' }])).toThrow(/registered twice/);
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
      Object.entries(TOOL_REGISTRATIONS).map(([name, r]) => [name, pathParams(r.tool.definition.input_schema)]).filter(([, ps]) => ps.length > 0),
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
