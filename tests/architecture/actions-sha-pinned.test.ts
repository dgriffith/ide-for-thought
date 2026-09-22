/**
 * @vitest-environment node
 *
 * Every GitHub Action is pinned to a commit SHA (#2250).
 *
 * `actions/checkout@v7` is a *mutable* reference — the tag can be moved,
 * reverted, or repointed by whoever controls the upstream repo, and the next
 * run then executes different code with no diff here to show it. A SHA cannot
 * move.
 *
 * This matters unevenly across the three workflows, and all three are pinned
 * anyway because partial pinning is worse than either extreme: a reader hitting
 * an unpinned `uses:` has to work out whether it was an exemption or an
 * oversight.
 *
 *   release.yml  Apple Developer ID signing material, six secret references,
 *                `contents: write`. The blast radius the issue is about.
 *   bench.yml    `issues: write`, and it runs `actions/github-script`. The
 *                issue assessed this as read-only — true when filed, and no
 *                longer: #2242 added the permission so the gate could file an
 *                issue when it fires.
 *   ci.yml       `CODECOV_TOKEN`, and no `permissions:` block of its own, so it
 *                inherits the repo default (`read` today — checked, not
 *                assumed; making that explicit is #2251).
 *
 * Dependabot updates SHA pins exactly as readily as tag pins and appends the
 * version as a trailing comment, so the version stays legible and the ongoing
 * cost is nil. `.github/dependabot.yml`'s `github-actions` entry already does
 * this — the gap was mutability, never staleness.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW_DIR = path.join(ROOT, '.github', 'workflows');

interface Use { file: string; line: number; raw: string; ref: string; action: string }

/**
 * Every `uses:` across the workflows, read as text rather than parsed YAML —
 * the trailing `# v1.2.3` comment is part of what's being asserted, and a YAML
 * parser throws it away.
 */
function uses(): Use[] {
  const out: Use[] = [];
  for (const file of fs.readdirSync(WORKFLOW_DIR).filter((f) => /\.ya?ml$/.test(f))) {
    const lines = fs.readFileSync(path.join(WORKFLOW_DIR, file), 'utf-8').split('\n');
    lines.forEach((text, i) => {
      const m = /^\s*(?:-\s*)?uses:\s*(\S+)/.exec(text);
      if (!m) return;
      const spec = m[1]!;
      // Local composite actions (`./.github/actions/x`) and docker refs have
      // no upstream tag to pin and aren't what this is about.
      if (spec.startsWith('./') || spec.startsWith('docker://')) return;
      const at = spec.lastIndexOf('@');
      out.push({
        file,
        line: i + 1,
        raw: text.trim(),
        action: at === -1 ? spec : spec.slice(0, at),
        ref: at === -1 ? '' : spec.slice(at + 1),
      });
    });
  }
  return out;
}

const SHA_RE = /^[0-9a-f]{40}$/;

describe('GitHub Actions are SHA-pinned (#2250)', () => {
  it('finds the uses: entries — an empty scan would pass vacuously', () => {
    const all = uses();
    expect(all.length).toBeGreaterThanOrEqual(20);
    expect([...new Set(all.map((u) => u.file))].sort()).toEqual([
      'bench.yml',
      'ci.yml',
      'release.yml',
    ]);
  });

  it('every one is a 40-character commit SHA', () => {
    const unpinned = uses().filter((u) => !SHA_RE.test(u.ref));

    if (unpinned.length > 0) {
      expect.fail(
        `Action(s) pinned to a mutable ref:\n\n` +
        unpinned.map((u) => `  ${u.file}:${u.line}  ${u.raw}`).join('\n') +
        `\n\nA tag can be moved or repointed upstream, so the next run executes ` +
        `different code with no diff here to show it (#2250). Resolve the tag to a ` +
        `commit and keep the version as a trailing comment:\n\n` +
        `  gh api repos/<owner>/<repo>/git/ref/tags/<tag> --jq .object.sha\n` +
        `  uses: <owner>/<repo>@<sha> # <version>\n\n` +
        `Dependabot updates SHA pins the same way it updates tags.`,
      );
    }
  });

  it('each carries the version as a trailing comment', () => {
    // Without it the diff is forty hex characters and review is impossible —
    // nobody can tell v7.0.1 from a reverted v6 by eye. This is also the form
    // Dependabot writes and reads, so dropping it costs the automation too.
    const undocumented = uses()
      .filter((u) => SHA_RE.test(u.ref))
      .filter((u) => !/#\s*v?\d+\.\d+/.test(u.raw))
      .map((u) => `${u.file}:${u.line}  ${u.raw}`);

    expect(
      undocumented,
      'a bare SHA is unreviewable — append `# vX.Y.Z`',
    ).toEqual([]);
  });

  it('the same action is pinned to one SHA everywhere', () => {
    // Five of the eight are used in all three workflows. Two SHAs for one
    // action means a partial upgrade — the exact state where the version
    // comment stops describing what actually runs somewhere.
    const byAction = new Map<string, Set<string>>();
    for (const u of uses()) {
      if (!byAction.has(u.action)) byAction.set(u.action, new Set());
      byAction.get(u.action)!.add(u.ref);
    }
    const split = [...byAction]
      .filter(([, refs]) => refs.size > 1)
      .map(([action, refs]) => `${action}: ${[...refs].join(', ')}`);

    expect(split, 'one action pinned to two different SHAs').toEqual([]);
  });

  it('release.yml in particular is fully pinned', () => {
    // Named separately so a regression says which perimeter was breached
    // rather than only that a count moved. This is the workflow holding the
    // signing material.
    const release = uses().filter((u) => u.file === 'release.yml');
    expect(release.length).toBeGreaterThan(0);
    expect(release.every((u) => SHA_RE.test(u.ref))).toBe(true);
  });
});
