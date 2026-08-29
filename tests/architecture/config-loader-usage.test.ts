/**
 * @vitest-environment node
 *
 * Ratchets on hand-rolled config *loading*, not location (#1913).
 *
 * `config-roots-doc.test.ts` (#1853) already polices WHERE a config file
 * lives — every `userData/`-relative path must be named in
 * `docs/config-roots.md`. It says nothing about HOW the file is read: a config
 * that read via a fresh `try { readFileSync; JSON.parse } catch { return
 * <default> }` instead of the shared `loadConfigFile`/`loadConfigFileSync`
 * (`config/config-store.ts`, #1640) passed that test every time — location
 * checked, mechanism didn't. Six files did exactly that (#1913): the doc named
 * their file, nobody checked that reading it went through the shared loader,
 * and a corrupt file on any of them silently read back as empty defaults with
 * no signal anywhere.
 *
 * The detector: a file that both reads from disk (`readFileSync` /
 * `fs.readFile` / bare `readFile`) AND calls `JSON.parse` is a candidate
 * hand-rolled reader. Once a file is migrated to `loadConfigFile` /
 * `loadConfigFileSync`, it stops calling `JSON.parse` itself — the shared
 * loader is the only place that still does, so the candidate list should only
 * ever contain files that either haven't migrated yet (tracked in CLAUDE.md's
 * "Config files" section) or aren't config in the #1640 sense at all (a cache,
 * a log, a per-item data file, model assets, unrelated file+JSON.parse in the
 * same file for two different reasons).
 *
 * ── On lexical scanning ─────────────────────────────────────────────────────
 * Same trade-off as `pattern-ratchets.test.ts`: text matching, not a parsed
 * AST, checked per FILE rather than per function. That means a file can land
 * on this list even when its disk-read and its `JSON.parse` are unrelated
 * (`sources/mine-references.ts` reads a note body on one line and
 * `JSON.parse`s a stripped LLM response on another — no config reader in
 * sight). Baselined anyway, with the reason recorded, rather than chasing a
 * cleverer regex: a maintained list beats a fragile one.
 *
 * This is a budget, not a verdict, exactly like `pattern-ratchets.test.ts`:
 * the count may go down (a migration) and must not go up without a decision
 * recorded here and in CLAUDE.md's "Config files" section.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAIN_DIR = 'src/main';

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) out.push(full);
    }
  };
  walk(path.join(ROOT, dir));
  return out;
}

const HAS_JSON_PARSE = /JSON\.parse\(/;
const HAS_DISK_READ = /readFileSync\(|(?:await\s+)?fs\.readFile\(|(?:await\s+)?readFile\(/;

/** Repo-relative paths of files that read a file from disk AND call
 *  `JSON.parse`, ANYWHERE in the file — see docstring for why that's a
 *  file-level, not function-level, signal. */
function candidates(): string[] {
  const out: string[] = [];
  for (const file of tsFilesUnder(MAIN_DIR)) {
    const src = fs.readFileSync(file, 'utf-8');
    if (HAS_JSON_PARSE.test(src) && HAS_DISK_READ.test(src)) out.push(path.relative(ROOT, file));
  }
  return out.sort();
}

/**
 * Every survivor, with why it isn't (yet) `loadConfigFile`/`loadConfigFileSync`.
 * Adding a file here is a decision to make in the PR that adds it, not a thing
 * that happens by accident — that's the whole point of the ratchet.
 */
const BASELINE: Record<string, string> = {
  // The shared loader itself — reads + JSON.parses by definition.
  'src/main/config/config-store.ts': 'the shared loader — this is its implementation',
  // Deliberate exception (#1913): must THROW on corruption, not default, so a
  // patch is never merged onto a silently-emptied file (#1891). See the
  // docstring on `readRawProjectConfig` for the full reasoning.
  'src/main/config/project-config-store.ts': 'must throw on corruption (#1891 clobber fix), not default — incompatible with loadConfigFile\'s never-throw contract',
  // Already tracked as hand-rolled in CLAUDE.md's "Config files" section —
  // migrate there, not here, when picked up.
  'src/main/clipper/clipper-config.ts': 'CLAUDE.md-tracked hand-rolled config (decrypt + lazy secret upgrade)',
  'src/main/llm/settings.ts': 'CLAUDE.md-tracked hand-rolled config (nested providers/models)',
  'src/main/skills/menu-config-store.ts': 'CLAUDE.md-tracked hand-rolled config (menu-config-store)',
  // Not config in the #1640 sense: read-only helper, or a cache/log/per-item
  // data file where "corrupt → report + default" isn't the right model.
  'src/main/ipc/read-json.ts': 'the OTHER blessed read helper (readJsonFileOr) — CLAUDE.md rule 5, not a defaulting config loader',
  'src/main/compute/audit.ts': 'NDJSON audit log, one JSON object per line — append-only log, not settings',
  'src/main/embeddings/wasm-embedder.ts': 'bundled tokenizer.json model asset shipped with the app, not user config',
  'src/main/help-docs/corpus-store.ts': 'generated help-docs corpus cache, not user config',
  'src/main/search/minisearch-provider.ts': 'search index cache — corrupt index is rebuilt, not defaulted-and-reported',
  'src/main/saved-views.ts': 'one file per saved view, not a single settings blob — a corrupt view is skipped, not defaulted',
  'src/main/sources/collections.ts': 'per-project collections data file — same shape question as saved-views, not picked up by #1913',
  'src/main/sources/mine-references.ts': 'unrelated in the same file: reads a note body on one line, JSON.parses a stripped LLM response on another — no config reader here',
  'src/main/compute/rpc-server.ts': 'unrelated in the same file: reads a note body via notebaseFs elsewhere, JSON.parses per-line RPC protocol messages off a socket — no config reader here',
  // Migrated (#1913) but still legitimately touch both patterns elsewhere in
  // the same file for a different (non-config) reason.
  'src/main/llm/conversation.ts': 'loadUIState migrated to loadConfigFile; the file\'s other JSON.parse/readFile calls load conversation transcripts, not config',
  'src/main/project-config.ts': 'readProjectConfig migrated to loadConfigFileSync; the file\'s other JSON.parse/readFile calls handle the separate encrypted secrets.json',
};

describe('config loader usage (#1913)', () => {
  it('the detector still finds things — a broken regex would pass vacuously', () => {
    expect(candidates().length).toBeGreaterThan(5);
  });

  it('every file/config.parse candidate is accounted for', () => {
    const found = candidates();
    const unexplained = found.filter((f) => !(f in BASELINE));
    const stale = Object.keys(BASELINE).filter((f) => !found.includes(f));
    expect(
      unexplained,
      'File(s) that read from disk and JSON.parse the result, without going through ' +
      '`loadConfigFile`/`loadConfigFileSync` (config/config-store.ts, #1640) and without a reason ' +
      'recorded in this test\'s BASELINE:\n\n' +
      `${unexplained.join('\n')}\n\n` +
      'If this is genuinely a new hand-rolled config reader, migrate it to loadConfigFile/loadConfigFileSync ' +
      'and update CLAUDE.md\'s "Config files" section instead of adding it here. If it\'s not config in the ' +
      '#1640 sense (a cache, a log, unrelated read+parse in the same file), add it to BASELINE with why.',
    ).toEqual([]);
    expect(
      stale,
      'File(s) in BASELINE that no longer match the detector — migrated, deleted, or the code moved. ' +
      `Remove the stale entry:\n\n${stale.join('\n')}`,
    ).toEqual([]);
  });
});
