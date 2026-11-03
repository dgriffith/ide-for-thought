/**
 * Project-relative paths are `/`-separated on every OS (#2989).
 *
 * `path.relative` — and slicing a root off an absolute path — speak the
 * platform separator, so on Windows they say `notes\a.md`. Minerva stores,
 * compares and emits relative paths as POSIX everywhere (graph IRIs, the
 * search index, history keys, publish plans and their `private/**`
 * exclusions, export URLs), and a backslash one silently matches nothing:
 * the first Windows run (#2180) found private notes in an export plan.
 *
 * So `src/main` produces relative paths through `projectRelative()`
 * (`path-containment.ts`). A bare `path.relative(` or `.slice(root.length + 1)`
 * fails here unless it's one of the few that only feed an absolute check —
 * listed with why.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { posixRelative } from '../helpers/posix-path';

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src', 'main');

/** `file → why` for the native uses that are right as they are. */
const ALLOWED: Record<string, string> = {
  'src/main/path-containment.ts':
    'Home of projectRelative. Its other native uses feed straight back into path.resolve / a ' +
    'segment check that splits on both separators, and never leave the module.',
  'src/main/notebase/watcher-ignore.ts':
    'Slices paths it has already made `/`-separated (toUnix), to match segments against isIgnoredEntry.',
  'src/main/publish/run-export.ts':
    'isUnder: a `..`/absolute test on a native relative path, which is never stored or emitted.',
};

const BARE = [/\bpath\.relative\(/, /\.slice\(\w*[Rr]oot\w*\.length \+ 1\)/];

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sources(full);
    return /\.(ts|mts|cts)$/.test(e.name) ? [full] : [];
  });
}

describe('project-relative paths go through projectRelative (#2989)', () => {
  const files = sources(SRC);

  it('finds the sources — an empty scan would pass vacuously', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('no bare path.relative or root-slice outside the allowlist', () => {
    const offenders = files.flatMap((f) => {
      const rel = posixRelative(ROOT, f);
      if (ALLOWED[rel]) return [];
      return fs.readFileSync(f, 'utf-8').split('\n').flatMap((line, i) =>
        /^\s*(\/\/|\*)/.test(line) || !BARE.some((re) => re.test(line)) ? [] : [`${rel}:${i + 1}: ${line.trim()}`]);
    });
    expect(
      offenders,
      'A project-relative path built with the platform separator — on Windows it reads `notes\\a.md` and ' +
        'matches nothing. Use projectRelative(root, abs) from src/main/path-containment.ts, or (for a path ' +
        'that is only ever an absolute check) add the file to ALLOWED with the reason:\n' + offenders.join('\n'),
    ).toEqual([]);
  });

  it('the allowlist names only real files that still need it', () => {
    for (const rel of Object.keys(ALLOWED)) {
      const text = fs.readFileSync(path.join(ROOT, rel), 'utf-8');
      expect(BARE.some((re) => re.test(text)), `${rel} no longer has a native relative path; drop it`).toBe(true);
    }
  });
});
