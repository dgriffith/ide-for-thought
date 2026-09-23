/**
 * @vitest-environment node
 *
 * CLAUDE.md / `docs/development.md` claims checked against the code (#2257,
 * #2258, epic #2268).
 *
 * The epic's thesis, and the reason this file exists rather than another round
 * of careful proofreading: **prose describing behavior drifts the moment
 * nothing checks it against the behavior.** That is not a general worry here,
 * it is a measured one. Commit `2f20c21b` (PR #1646, titled *"docs: fix dev-doc
 * lint-description drift"*) wrote CLAUDE.md's sequential "then… then…"
 * description of `pnpm lint` at 15:28 on 2026-08-02; `d39277fc` (PR #1645) made
 * the three checks parallel at 16:17 — **49 minutes later, the same day**. The
 * doc fix was obsolete before anyone read it, and stayed wrong for seven weeks,
 * in two documents. Proofreading cannot win that race. A test can.
 *
 * So each block below pins one CLAUDE.md claim to the artifact it describes.
 * All six were wrong or incomplete when this was written; the point is not that
 * they are right now — it is that the next divergence fails a PR instead of
 * being discovered by a reader who believed the doc.
 *
 * ── Scope, honestly ─────────────────────────────────────────────────────────
 * This checks claims with a machine-readable counterpart: a script's control
 * flow, a path on disk, a function's parameter list, a constant's contents, a
 * code block's text. CLAUDE.md is mostly *reasoning* — why a rule exists, what
 * it traded away, which alternative was rejected — and none of that is
 * checkable here, nor should it be. What this closes is the narrow band of
 * statements that are simply true or false about the current tree, which is
 * also the band where being wrong is most expensive: it sends someone to the
 * wrong file, or has them run the wrong command.
 *
 * The companion `config-roots-doc.test.ts` (#1853) is the same idea aimed at
 * `docs/config-roots.md`, and was the model for this one.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const CLAUDE_MD = 'CLAUDE.md';
const DEV_MD = 'docs/development.md';
const RATCHETS_MD = 'docs/architecture-ratchets.md';

const claude = readFileSync(CLAUDE_MD, 'utf8');
const devDoc = readFileSync(DEV_MD, 'utf8');

/** The single line of a markdown doc that introduces `pnpm lint`. */
function lineContaining(doc: string, needle: string): string {
  const line = doc.split('\n').find((l) => l.includes(needle));
  if (line === undefined) throw new Error(`no line containing ${JSON.stringify(needle)}`);
  return line;
}

// ── 1. `pnpm lint` is parallel, and both docs say so ────────────────────────

describe('the documented `pnpm lint` shape matches scripts/lint.mjs (#2257)', () => {
  const lintScript = readFileSync('scripts/lint.mjs', 'utf8');

  /**
   * `await Promise.all(CHECKS.map(run))` — the one line that makes this
   * parallel. Deliberately anchored on the real construct rather than on the
   * word "parallel" in a comment, which is prose about the code and could
   * itself be the stale thing.
   */
  const isParallel = /Promise\.all\(\s*CHECKS\.map\(/.test(lintScript);

  it('reads the lint runner (a broken scan would pass everything below vacuously)', () => {
    expect(lintScript.length, 'scripts/lint.mjs looks empty').toBeGreaterThan(500);
    expect(
      /const CHECKS = \[/.test(lintScript),
      'scripts/lint.mjs no longer declares a CHECKS array — this test can no longer read it',
    ).toBe(true);
  });

  it('names all three checks in both docs', () => {
    // Derived from the script, not hardcoded: a fourth check would have to be
    // documented, and a removed one would have to be un-documented.
    const checkNames = [...lintScript.matchAll(/name: '([^']+)'/g)].map((m) => m[1]!);
    expect(checkNames.sort()).toEqual(['eslint', 'svelte-check', 'tsc']);

    for (const [name, doc] of [[CLAUDE_MD, claude], [DEV_MD, devDoc]] as const) {
      const line = lineContaining(doc, '`pnpm lint`');
      for (const check of checkNames) {
        expect(line.includes(check), `${name}'s pnpm lint description omits "${check}"`).toBe(true);
      }
    }
  });

  it('describes the checks as concurrent, not sequential', () => {
    expect(isParallel, 'scripts/lint.mjs stopped using Promise.all — invert the doc wording too').toBe(true);

    for (const [name, doc] of [[CLAUDE_MD, claude], [DEV_MD, devDoc]] as const) {
      const line = lineContaining(doc, '`pnpm lint`');
      expect(
        /parallel|concurrent/i.test(line),
        `${name} describes \`pnpm lint\` without saying the checks run in parallel.\n\n` +
          `  ${line.trim()}\n\n` +
          'scripts/lint.mjs runs them with `await Promise.all(CHECKS.map(run))`. The difference is ' +
          'not cosmetic: a parallel run reports EVERY check that failed, so a reader told they run ' +
          'in sequence will fix the first block and assume the rest passed.',
      ).toBe(true);
      expect(
        /,\s*then\s+`/.test(line),
        `${name} still describes \`pnpm lint\` as "X, then Y, then Z" — the exact wording #1645 ` +
          'obsoleted 49 minutes after #1646 wrote it.',
      ).toBe(false);
    }
  });

  it('documents lint:seq, which is where the sequential form actually lives', () => {
    // It exists in package.json, and CLAUDE.md described its behavior while
    // naming the other script — the most confusing possible arrangement.
    expect(readFileSync('package.json', 'utf8')).toContain('"lint:seq"');
    expect(claude, 'CLAUDE.md never mentions `pnpm lint:seq`').toContain('lint:seq');
  });
});

// ── 2. Every repo path the docs name exists ─────────────────────────────────

describe('every concrete repo path named in the docs exists (#2257)', () => {
  /**
   * The finding behind this one was `eslint.config.js` in CLAUDE.md when only
   * `eslint.config.mjs` exists — and the same file spelled it `.mjs` correctly
   * in four other places. A wrong filename is the cheapest possible doc defect
   * to introduce and one of the more expensive to hit: it sends a reader to a
   * file that isn't there, which reads as "this project is different from what
   * I expected" rather than "the doc is wrong".
   *
   * (That particular one was already fixed by the time #2257 was worked; this
   * is the guard it never got.)
   */
  const DOCS = [CLAUDE_MD, DEV_MD, RATCHETS_MD];

  /** Path prefixes that name something tracked in this repo. */
  const REPO_ROOT_DIR = /^(src|tests|docs|scripts|build|resources|website|\.github)\//;
  /** Root-level files the docs refer to by bare name. */
  const REPO_ROOT_FILE = new Set([
    'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'forge.config.ts',
    'eslint.config.mjs', 'vitest.config.mts', 'vite.main.config.mts',
    'vitest.bench.config.ts', '.nvmrc', 'README.md', 'CLAUDE.md', 'LICENSE',
  ]);

  /**
   * Root-level filename STEMS, derived from the tree — `eslint.config`,
   * `vitest.config`, `package`, … A bare backticked name sharing a stem with a
   * real root file but spelling the extension differently is the defect #2257
   * item 2 actually was (`eslint.config.js`, four correct `.mjs` spellings in
   * the same document), and an allowlist of known-GOOD names cannot see it: the
   * misspelling simply isn't in the allowlist, so it is skipped as "not a repo
   * path" rather than flagged. Found by probing this test with the original
   * defect and watching it pass.
   */
  const rootStems = new Map<string, string>();
  for (const entry of readdirSync('.', { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue;
    const dot = entry.name.lastIndexOf('.');
    if (dot > 0) rootStems.set(entry.name.slice(0, dot), entry.name);
  }

  /**
   * Build artifacts: real paths the docs are right to name, which simply
   * aren't on disk in a checkout that hasn't run the build step that makes
   * them. Listed rather than pattern-matched, so a genuinely missing file
   * can't hide behind a loose rule.
   */
  const GENERATED: Record<string, string> = {
    'resources/help-docs/corpus.json': 'built by scripts/build-help-corpus.mjs (pretest/predev); gitignored',
    'resources/help-docs/': 'same — the whole directory is a build output',
  };

  function pathsNamedIn(doc: string): string[] {
    const out = new Set<string>();
    for (const m of readFileSync(doc, 'utf8').matchAll(/`([^`\n]+)`/g)) {
      // Strip a trailing file:line / file:line-line citation — `foo.ts:12-20`.
      const token = m[1]!.trim().replace(/:\d+(-\d+)?(,\d+)*$/, '');
      const dot = token.lastIndexOf('.');
      const sharesRootStem = !token.includes('/') && dot > 0 && rootStems.has(token.slice(0, dot));
      if (!(REPO_ROOT_DIR.test(token) || REPO_ROOT_FILE.has(token) || sharesRootStem)) continue;
      // Skip globs and anything with prose punctuation in it: `src/main/**`,
      // `stores/*.svelte.ts`, `handle(Channels.X)`. Those name a SHAPE, not a
      // file, and resolving them is a different (and much noisier) check.
      if (/[*{}()\s<>|]/.test(token)) continue;
      out.add(token);
    }
    return [...out].sort();
  }

  it('finds a substantial set of paths to check', () => {
    const all = DOCS.flatMap(pathsNamedIn);
    expect(all.length, 'the backtick scan found almost nothing — did the regex break?').toBeGreaterThan(60);
    // Anchors: one file, one directory, one root-level config.
    expect(all).toContain('src/shared/channels.ts');
    expect(all).toContain('eslint.config.mjs');
  });

  for (const doc of DOCS) {
    it(`${doc} names no path that does not exist`, () => {
      const missing = pathsNamedIn(doc).filter((p) => !existsSync(p) && !(p in GENERATED));
      expect(
        missing,
        `${doc} refers to ${missing.length} path(s) that aren't in the tree:\n\n` +
          `${missing.map((p) => `  ${p}`).join('\n')}\n\n` +
          'Either the file moved (fix the doc) or it was deleted (fix the doc, and check whether the ' +
          'convention it illustrated still holds). If it is a build artifact that only exists after a ' +
          'build step, add it to GENERATED in this test with the step that produces it.',
      ).toEqual([]);
    });
  }

  it('keeps GENERATED live — no entry for a file that is now committed', () => {
    // If a build output becomes a tracked file, the exemption should go rather
    // than sit here hiding a future real deletion.
    //
    // "Committed" is `git ls-files`, not `existsSync`. Every entry here is a
    // build output that IS expected on disk — `resources/help-docs/corpus.json`
    // is built by the `pretest` script, so by the time this assertion runs the
    // file it is asking about has just been written by the same command. The
    // existence form passed only on a tree that had never been built: red on
    // every developer machine, and red on CI exactly when #2246's cache
    // restores it (green on a cold cache, so it read as flaky rather than
    // wrong). Tracked-ness is what the comment above always meant.
    // A directory key lists its children rather than itself, so it counts as
    // committed when anything under it is tracked — otherwise the two-entry
    // map would have one entry nothing could ever report.
    const tracked = execFileSync('git', ['ls-files', '-z', ...Object.keys(GENERATED)], {
      encoding: 'utf8',
    })
      .split('\0')
      .filter(Boolean);
    const stale = Object.keys(GENERATED).filter((p) =>
      p.endsWith('/') ? tracked.some((t) => t.startsWith(p)) : tracked.includes(p),
    );
    expect(
      stale,
      `GENERATED entries that are committed files now — drop them: ${stale.join(', ')}`,
    ).toEqual([]);
  });
});

// ── 3. showPrompt / showConfirm live where the docs say, with the documented
//      parameters ──────────────────────────────────────────────────────────

describe('the Dialogs section points at the real dialogs (#2257)', () => {
  const STORES_DIR = 'src/renderer/lib/stores';

  /** Every renderer file that *declares* (not merely calls) `function <name>(`. */
  function declaringFiles(name: string): string[] {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|svelte)$/.test(full)) {
          if (new RegExp(`function\\s+${name}\\s*\\(`).test(readFileSync(full, 'utf8'))) out.push(full);
        }
      }
    };
    walk('src/renderer');
    return out.sort();
  }

  it('finds showPrompt and showConfirm declared only in the dialogs store', () => {
    // CLAUDE.md said "in App.svelte" for both, in two separate sections, while
    // a third section two hundred lines above used `dialogs.showConfirm()` as
    // its worked example. App.svelte only DESTRUCTURES them off the store.
    expect(declaringFiles('showConfirm')).toEqual([`${STORES_DIR}/dialogs.svelte.ts`]);
    expect(declaringFiles('showPrompt')).toEqual([`${STORES_DIR}/dialogs.svelte.ts`]);
  });

  it('both docs name the module that declares them', () => {
    for (const [name, doc] of [[CLAUDE_MD, claude], [DEV_MD, devDoc]] as const) {
      expect(
        doc.includes(`${STORES_DIR}/dialogs.svelte.ts`),
        `${name} discusses showConfirm/showPrompt without naming ${STORES_DIR}/dialogs.svelte.ts, ` +
          'which is where they are defined. Pointing at App.svelte sends a reader grepping through ' +
          "the composition root for a function that is only destructured there.",
      ).toBe(true);
    }
  });

  it('CLAUDE.md documents every parameter showConfirm actually takes', () => {
    const src = readFileSync(`${STORES_DIR}/dialogs.svelte.ts`, 'utf8');
    const decl = /function\s+showConfirm\s*\(([\s\S]*?)\)\s*:\s*Promise<boolean>/.exec(src);
    expect(decl, 'could not read showConfirm’s declaration — did its shape change?').not.toBeNull();

    // Top-level parameter NAMES only: split on commas that aren't inside a
    // `{ … }` inline type, then take the identifier before `:` or `=`.
    const params: string[] = [];
    let depth = 0;
    let buf = '';
    for (const ch of decl![1]!) {
      if (ch === '{' || ch === '<') depth++;
      else if (ch === '}' || ch === '>') depth--;
      if (ch === ',' && depth === 0) { params.push(buf); buf = ''; } else buf += ch;
    }
    params.push(buf);
    const names = params
      .map((p) => /^\s*([A-Za-z_$][\w$]*)/.exec(p)?.[1])
      .filter((n): n is string => Boolean(n));

    expect(names, 'showConfirm’s parameter list is not what this test can parse').toContain('message');

    // CLAUDE.md names `showConfirm(…)` in two places on purpose: a short form
    // in the UI philosophy bullet, and the canonical full signature in the
    // Dialogs section. Requiring EVERY mention to be complete would be a rule
    // about prose; requiring that AT LEAST ONE is complete is the actual
    // property — there is somewhere to look that tells the whole truth. So
    // this scores the best mention and reports it.
    const mentions = claude.split('\n').filter((l) => l.includes('`showConfirm(message'));
    expect(mentions.length, 'CLAUDE.md no longer shows a showConfirm signature').toBeGreaterThan(0);
    const scored = mentions
      .map((line) => ({ line, missing: names.filter((n) => !line.includes(n)) }))
      .sort((a, b) => a.missing.length - b.missing.length);
    const documented = scored[0]!.line;
    const undocumented = scored[0]!.missing;
    expect(
      undocumented,
      `No showConfirm signature in CLAUDE.md documents parameter(s): ${undocumented.join(', ')}.\n\n` +
        `  closest: ${documented.trim()}\n` +
        `  actual:  showConfirm(${names.join(', ')})\n\n` +
        'An incomplete signature is worse than none — it reads as complete, so the omitted option ' +
        '(here `options.hideDontAskAgain`) is invisible to anyone who needs it.',
    ).toEqual([]);
  });
});

// ── 4. The documented SPARQL prefixes are the injected ones ─────────────────

describe('CLAUDE.md lists exactly the auto-injected SPARQL prefixes (#2257)', () => {
  /**
   * Real user impact, not bookkeeping: this list is what someone writing SPARQL
   * in the Query panel may use *without* a PREFIX line. CLAUDE.md named eight
   * while the code injected fifteen, so `types:` — the namespace every
   * user-defined note type (#2036) compiles into — was undiscoverable from the
   * documentation.
   */
  const stateSrc = readFileSync('src/main/graph/state.ts', 'utf8');
  const block = /export const STANDARD_PREFIXES: \[string, string\]\[\] = \[([\s\S]*?)\n\];/.exec(stateSrc);

  it('reads STANDARD_PREFIXES out of graph/state.ts', () => {
    expect(block, 'STANDARD_PREFIXES is no longer declared in the shape this test reads').not.toBeNull();
  });

  const codePrefixes = [...(block?.[1] ?? '').matchAll(/\[\s*'([^']+)'\s*,/g)].map((m) => m[1]!);

  it('is injected by the query path (so the list is the one that matters)', () => {
    // Guards against documenting a constant that nothing uses.
    expect(codePrefixes.length).toBeGreaterThan(10);
    expect(readFileSync('src/main/graph/queries/sparql.ts', 'utf8')).toContain('for (const [prefix, iri] of STANDARD_PREFIXES)');
  });

  it('documents every injected prefix and no others', () => {
    // Read from the single bullet that carries the list, which is why that
    // bullet carries *only* the list. The first draft of this test scanned the
    // same line as a parenthetical re-listing seven of the prefixes in prose,
    // and a probe that deleted `foaf` from the canonical list still passed —
    // the prose copy kept the set complete. Two lists on one line is one list
    // too many for a check like this; the commentary moved to sub-bullets.
    const line = lineContaining(claude, 'Standard prefixes');
    const documented = [...line.matchAll(/`([a-z]+)`/g)].map((m) => m[1]!);

    const missing = codePrefixes.filter((p) => !documented.includes(p));
    const extra = documented.filter((p) => !codePrefixes.includes(p));
    expect(
      { missing, extra },
      'CLAUDE.md\'s auto-injected SPARQL prefix list has drifted from STANDARD_PREFIXES ' +
        '(src/main/graph/state.ts).\n\n' +
        `  missing from the doc: ${missing.join(', ') || '(none)'}\n` +
        `  in the doc but not injected: ${extra.join(', ') || '(none)'}\n\n` +
        'The doc list is what a user may write in the Query panel without a PREFIX line. An ' +
        'under-count makes a usable namespace invisible; an over-count produces a query that ' +
        "doesn't parse.",
    ).toEqual({ missing: [], extra: [] });

    // The prose count, too — "eight" outlived the eight, and a reader who
    // counts the list against the stated number and finds them different has
    // no way to know which half is stale.
    //
    // Spelled-out numbers are accepted because that is how the sentence reads,
    // but only the RIGHT spelled-out number: an earlier draft accepted the
    // literal word "fifteen" as a fallback, which would have kept passing
    // forever once a sixteenth prefix landed — a check that can only ever be
    // satisfied by the answer it was written with is not a check.
    const WORDS = [
      'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
      'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
      'eighteen', 'nineteen', 'twenty',
    ];
    const n = codePrefixes.length;
    const spelled = WORDS[n];
    expect(
      new RegExp(`\\b${n}\\b`).test(line) || (spelled !== undefined && new RegExp(`\\b${spelled}\\b`, 'i').test(line)),
      `CLAUDE.md's prefix bullet doesn't state the real count (${n}${spelled ? ` / "${spelled}"` : ''}).\n\n` +
        `  ${line.trim()}\n\n` +
        'Update the number in the same edit as the list.',
    ).toBe(true);
  });
});

// ── 5. The integrity query in CLAUDE.md matches its executable twin ─────────

describe('the CLAUDE.md integrity query matches integrity.ts (#2257)', () => {
  /**
   * CLAUDE.md explicitly instructs "Keep the query below in sync with
   * `UNREVIEWED_LLM_WRITES_QUERY`". It had not been: the doc copy wrote
   * `LCASE(?extractedBy)` where the executable one writes
   * `LCASE(STR(?extractedBy))`. Not a cosmetic difference — `LCASE` is defined
   * on simple literals, so a language-tagged or typed `thought:extractedBy`
   * makes the expression an error, and SPARQL's FILTER drops erroring rows. The
   * doc copy would silently under-report the exact bypasses it exists to find.
   *
   * The two differ legitimately in one way: the executable copy carries no
   * PREFIX lines, because `queryGraph` injects them (see block 4). So the
   * comparison drops PREFIX lines and normalizes whitespace, and nothing else.
   *
   * Read as text rather than imported: `integrity.ts` reaches `graph/index.ts`,
   * which pulls the whole graph stack, and this is a plain node-environment
   * file-comparison test.
   */
  const integritySrc = readFileSync('src/main/graph/integrity.ts', 'utf8');
  const exported = /export const UNREVIEWED_LLM_WRITES_QUERY = `([\s\S]*?)`;/.exec(integritySrc);
  const docBlock = /```sparql\n([\s\S]*?)```/.exec(claude);

  const normalize = (q: string): string =>
    q.split('\n')
      .filter((l) => !/^\s*PREFIX\s/i.test(l))
      .map((l) => l.trim())
      .filter(Boolean)
      .join('\n');

  it('finds both copies', () => {
    expect(exported, 'UNREVIEWED_LLM_WRITES_QUERY not found in src/main/graph/integrity.ts').not.toBeNull();
    expect(docBlock, 'no ```sparql block in CLAUDE.md').not.toBeNull();
    expect(normalize(exported![1]!)).toContain('thought:Component');
  });

  it('is byte-identical modulo the injected PREFIX lines', () => {
    expect(
      normalize(docBlock![1]!),
      'The integrity query in CLAUDE.md has drifted from UNREVIEWED_LLM_WRITES_QUERY in ' +
        'src/main/graph/integrity.ts. CLAUDE.md tells the reader to keep them in sync; this is that ' +
        'instruction made executable. The executable copy is canonical — it is the one ' +
        'tests/main/graph/trust-integrity.test.ts runs. Copy it into the doc block, keeping the ' +
        'PREFIX lines (queryGraph injects those, so the source copy has none).',
    ).toBe(normalize(exported![1]!));
  });
});

// ── 6. The IPC recipe names every mandatory step (#2258) ────────────────────

describe('the IPC-channel recipe is complete (#2258)', () => {
  /**
   * The five-step recipe omitted two mandatory steps, one of which is
   * compile-blocking. A contributor following it hit a `tsc` error the
   * instructions hadn't mentioned, and then — after fixing that — a red CI on
   * two snapshots nobody told them to regenerate. `docs/development.md` was the
   * sharper version of the same defect: it *named* `ipc-contract.ts` one
   * sentence before reciting the five steps that leave it out.
   *
   * Derived end-to-end from #2222 (`SOURCES_QUEUE_COUNTS`), the most recent
   * real channel addition at the time of writing, rather than from either
   * document.
   */
  const ipcSection = /### IPC Pattern\n([\s\S]*?)\n### IPC error handling/.exec(claude)?.[1] ?? '';

  it('extracts the IPC Pattern section', () => {
    expect(ipcSection.length, 'could not find the IPC Pattern section in CLAUDE.md').toBeGreaterThan(400);
  });

  /**
   * The claim that makes the ChannelMap step mandatory rather than advisory:
   * both typed wrappers are keyed on `ChannelMap`, and there is no raw
   * `ipcMain.handle` to fall back to. If a second one ever appears, the doc's
   * "it won't compile" becomes false and this fires first.
   */
  it('has exactly one ipcMain.handle call site in src/main — the typed wrapper', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (full.endsWith('.ts')) {
          const src = readFileSync(full, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
          if (/ipcMain\.handle\s*\(/.test(src)) offenders.push(full);
        }
      }
    };
    walk('src/main');
    expect(
      offenders,
      'ipcMain.handle outside src/main/ipc/typed-ipc.ts. The whole reason the ChannelMap entry is a ' +
        'mandatory (compile-blocking) step is that the typed handle() wrapper is the only way to ' +
        'register a channel. A raw call is an escape hatch around the contract — and it makes ' +
        "CLAUDE.md's IPC Pattern section untrue.",
    ).toEqual(['src/main/ipc/typed-ipc.ts']);
  });

  it('names every file a channel addition has to touch', () => {
    // Exactly the set #2222 touched on the contract spine, plus the two
    // snapshots it had to re-bless.
    const REQUIRED: Record<string, string> = {
      'src/shared/channels.ts': 'the channel constant',
      'src/shared/ipc-contract.ts': 'the ChannelMap entry — compile-blocking, and the step #2258 is about',
      'src/main/ipc/register-': 'the registrar that calls handle()',
      'src/preload/preload.ts': 'the contextBridge method',
      'src/renderer/lib/ipc/client.ts': 'the renderer-facing API interface',
      'tests/preload/preload-bridge.test.ts': 'the window.api snapshot — fails CI until regenerated',
      'tests/main/ipc/registration.test.ts': 'the registered-channel snapshot — same',
    };
    const omitted = Object.entries(REQUIRED)
      .filter(([path]) => !ipcSection.includes(path))
      .map(([path, why]) => `  ${path} — ${why}`);
    expect(
      omitted,
      `CLAUDE.md's IPC Pattern section doesn't mention:\n\n${omitted.join('\n')}\n\n` +
        'Every one of these is load-bearing for a channel addition. Leaving one out means a ' +
        'contributor following the recipe meets a tsc error or a red CI the instructions never ' +
        'warned them about — which is how the recipe read before #2258.',
    ).toEqual([]);
  });

  it('the ChannelMap entry is described as mandatory, not optional', () => {
    expect(
      /compile-blocking|won't compile|does not typecheck|not optional/i.test(ipcSection),
      'The IPC recipe lists the ChannelMap entry without saying it is compile-blocking. A reader ' +
        'who thinks it is bookkeeping will do it last, or skip it, and meet tsc instead.',
    ).toBe(true);
  });

  it('docs/development.md connects ipc-contract.ts to the step list', () => {
    // The original defect verbatim: the file was named one sentence before a
    // recipe that left it out, so the two facts sat side by side unconnected.
    const para = devDoc.slice(devDoc.indexOf('IPC channels are declared'), devDoc.indexOf('IPC channels are declared') + 900);
    expect(para).toContain('ipc-contract.ts');
    expect(
      /ChannelMap|compile-blocking/i.test(para),
      "docs/development.md names ipc-contract.ts but doesn't say the ChannelMap entry is a step.",
    ).toBe(true);
  });
});
