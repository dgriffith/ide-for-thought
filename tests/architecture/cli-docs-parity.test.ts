/**
 * @vitest-environment node
 *
 * `docs/cli.md` and the CLI's own `--help` match the dispatch table (#2263,
 * epic #2268).
 *
 * The CLI's command surface lives in three places that have to agree: the
 * `switch (args.command)` in `src/cli/run.ts` (what actually runs), the `HELP`
 * string a few hundred lines above it (what `--help` prints), and `docs/cli.md`
 * (what a reader is told). Two of the three are hand-maintained prose about the
 * first, and both had drifted by the time this test was written: `grep` and
 * `eval` were implemented, absent from the doc's command table, and `eval` was
 * absent from the doc entirely; the MCP tool list named 7 of 8, omitting
 * `grep_notes`. The doc also still called MCP "the forthcoming MCP subcommand"
 * forty lines after documenting it as shipped.
 *
 * That is the epic's thesis in miniature — prose describing behaviour drifts the
 * moment nothing checks it against the behaviour. This is the check, modelled on
 * `tests/architecture/config-roots-doc.test.ts`.
 *
 * ── Scope, honestly ─────────────────────────────────────────────────────────
 * It checks that every command and every MCP tool is NAMED, not that what is
 * said about it is true. A row whose Purpose or Output column is wrong still
 * passes. Naming the command is the part that was actually being forgotten, and
 * it's the part with one machine-checkable spelling.
 *
 * It also only reads `src/cli/run.ts` and `src/cli/mcp.ts` as text. A command
 * dispatched from somewhere else entirely would be invisible — but both the
 * dispatch and the pre-dispatch special cases (`mcp`, `eval`) live in `runCli`
 * by construction, since `runCli` IS the command surface (it returns
 * `{ stdout, stderr, code }` for one whole invocation), and the anchor test
 * below fails loudly if the shapes this parses stop being found.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const RUN = 'src/cli/run.ts';
const MCP = 'src/cli/mcp.ts';
const DOC = 'docs/cli.md';

const runSrc = readFileSync(RUN, 'utf8');
const mcpSrc = readFileSync(MCP, 'utf8');
const doc = readFileSync(DOC, 'utf8');

/**
 * Commands reach the user two ways in `runCli`:
 *   - `case 'query':` … inside `switch (args.command)`, the main dispatch;
 *   - `if (args.command === 'mcp')` — the two commands handled before it
 *     (`mcp` owns its own IO, `eval` resolves its own per-case roots).
 * Both shapes, so neither kind of command can be added invisibly.
 */
function cliCommands(): string[] {
  const found = new Set<string>();

  const switchAt = runSrc.indexOf('switch (args.command)');
  if (switchAt !== -1) {
    // From the switch to the end of `runCli`'s try block. `default:` bounds it
    // — every case label precedes it.
    const body = runSrc.slice(switchAt, runSrc.indexOf('default:', switchAt));
    for (const m of body.matchAll(/case\s+'([a-z][a-z-]*)'\s*:/g)) found.add(m[1]!);
  }

  for (const m of runSrc.matchAll(/args\.command\s*===\s*'([a-z][a-z-]*)'/g)) found.add(m[1]!);

  return [...found].sort();
}

/** `name: 'query_graph',` entries in the `MCP_TOOLS` array. */
function mcpToolNames(): string[] {
  const at = mcpSrc.indexOf('export const MCP_TOOLS');
  const body = at === -1 ? '' : mcpSrc.slice(at);
  return [...body.matchAll(/^\s*name:\s*'([a-z][a-z_]*)',/gm)].map((m) => m[1]!).sort();
}

/** The `Commands:` section of the `HELP` template literal. */
function helpBlock(): string {
  const at = runSrc.indexOf('Commands:');
  return at === -1 ? '' : runSrc.slice(at, runSrc.indexOf('Options:', at));
}

describe('docs/cli.md matches the CLI (#2263)', () => {
  const commands = cliCommands();
  const tools = mcpToolNames();

  it('finds the command surface it is meant to police', () => {
    // Without this, a regex that stopped matching would make every assertion
    // below pass by checking nothing.
    expect(commands.length, `no commands parsed out of ${RUN}`).toBeGreaterThanOrEqual(8);
    expect(tools.length, `no tools parsed out of ${MCP}`).toBeGreaterThanOrEqual(6);
    expect(doc.length, `${DOC} looks empty`).toBeGreaterThan(2000);
    expect(helpBlock().length, `no Commands: block found in ${RUN}'s HELP`).toBeGreaterThan(200);

    // Anchors: one main-dispatch command, both pre-dispatch ones, one tool.
    expect(commands).toContain('query');
    expect(commands).toContain('mcp');
    expect(commands).toContain('eval');
    expect(tools).toContain('query_graph');
  });

  it('documents every command the CLI dispatches', () => {
    const undocumented = commands.filter((c) => !doc.includes(`\`${c}`));
    expect(
      undocumented,
      `Command(s) the CLI runs that ${DOC} never names.\n\n  ${undocumented.join('\n  ')}\n\n` +
        `Add a row to the Commands table in ${DOC} — and check the status blockquote at the ` +
        'top, which lists the surface as a sentence. A command nobody is told about is a ' +
        'command nobody uses.',
    ).toEqual([]);
  });

  it('lists every command in the CLI\'s own --help', () => {
    const help = helpBlock();
    const missing = commands.filter((c) => !new RegExp(`^\\s{2}${c}\\b`, 'm').test(help));
    expect(
      missing,
      `Command(s) the CLI runs that \`minerva --help\` never mentions.\n\n  ${missing.join('\n  ')}\n\n` +
        `Add a line to the Commands: block of HELP in ${RUN}. \`--help\` is the only ` +
        'documentation a user reaches without leaving the terminal.',
    ).toEqual([]);
  });

  it('documents every MCP tool the server exposes', () => {
    const undocumented = tools.filter((t) => !doc.includes(`\`${t}\``));
    expect(
      undocumented,
      `MCP tool(s) the server exposes that ${DOC} never names.\n\n  ${undocumented.join('\n  ')}\n\n` +
        `Add them to the tool list in the "MCP server" section of ${DOC}. An agent client ` +
        'discovers tools over the wire, but a human deciding whether to point one at their ' +
        'thoughtbase reads this page.',
    ).toEqual([]);
  });

  it('does not describe shipped subcommands as future work', () => {
    // The specific drift #2263 found: the doc called MCP "forthcoming" forty
    // lines after documenting it, and described the running-app write
    // coordination `src/cli/routed-engine.ts` implements as "future work".
    const forwardLooking = /forthcoming|will wrap|is future work|are future work/gi;
    const hits = [...doc.matchAll(forwardLooking)].map((m) => m[0]);
    expect(
      hits,
      `${DOC} describes something as forthcoming/future. Every command in the table is ` +
        'implemented today, and routed-engine.ts (#1524) shipped the running-app write ' +
        'coordination this page used to defer. If a genuinely-unbuilt thing needs describing, ' +
        'phrase it as a named open issue rather than as a promise the reader cannot date.',
    ).toEqual([]);
  });
});
