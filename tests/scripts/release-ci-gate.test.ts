/**
 * The "main CI passed for the released SHA" rule (#2371).
 *
 * A tag could be cut on a commit whose main `ci.yml` run was cancelled or red,
 * and release.yml — which re-runs lint and audit but not the test suite or
 * e2e — would build, sign, notarize and draft it without complaint. The rule
 * lives in `scripts/lib/release-ci-gate.mjs`, shared by `tag-release.mjs`
 * (local) and `check-release-ci.mjs` (release.yml); this pins the rule, and
 * `tests/architecture/release-tag-gate.test.ts` pins that release.yml runs it.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  ciVerdict,
  fetchCiRuns,
  latestRun,
  relevantRuns,
  waitForVerdict,
} from '../../scripts/lib/release-ci-gate.mjs';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

interface Run {
  id: number;
  head_sha: string;
  event: string;
  head_branch: string;
  status: string;
  conclusion: string | null;
  run_attempt: number;
  created_at: string;
  html_url: string;
}

function run(over: Partial<Run> = {}): Run {
  const id = over.id ?? 100;
  return {
    id,
    head_sha: SHA,
    event: 'push',
    head_branch: 'main',
    status: 'completed',
    conclusion: 'success',
    run_attempt: 1,
    created_at: '2026-09-27T10:00:00Z',
    html_url: `https://github.com/o/r/actions/runs/${id}`,
    ...over,
  };
}

describe('a successful main run passes', () => {
  it('accepts completed + success', () => {
    const v = ciVerdict([run()], SHA);
    expect(v.ok).toBe(true);
    expect(v.state).toBe('success');
    expect(v.message).toContain('runs/100');
  });

  it('accepts a rerun that went green — the run reflects its latest attempt', () => {
    // Verified against the API: a rerun bumps run_attempt on the SAME run and
    // its conclusion becomes the latest attempt's; attempt 1's failure lives
    // only under /runs/<id>/attempts/1.
    const v = ciVerdict([run({ run_attempt: 2 })], SHA);
    expect(v.ok).toBe(true);
    expect(v.message).toContain('attempt 2');
  });
});

describe('no run at all', () => {
  it('refuses, and says the commit may not be on main', () => {
    const v = ciVerdict([], SHA);
    expect(v).toMatchObject({ ok: false, state: 'missing' });
    expect(v.message).toContain(SHA);
    expect(v.message).toMatch(/not on main/);
  });

  it('ignores runs that cannot vouch for this commit', () => {
    // A PR run, a run on another branch, and a run for a different SHA are
    // all "no main run" for the SHA that ships.
    const v = ciVerdict(
      [
        run({ event: 'pull_request' }),
        run({ head_branch: 'feature' }),
        run({ head_sha: OTHER }),
      ],
      SHA,
    );
    expect(v.state).toBe('missing');
  });

  it('treats a missing/empty payload as no run', () => {
    expect(ciVerdict(undefined as unknown as Run[], SHA).state).toBe('missing');
  });
});

describe('a completed run that did not succeed', () => {
  it.each(['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure', 'neutral', 'skipped'])(
    'refuses %s, naming the conclusion and the run URL',
    (conclusion) => {
      const v = ciVerdict([run({ conclusion })], SHA);
      expect(v).toMatchObject({ ok: false, state: 'failed' });
      expect(v.message).toContain(`"${conclusion}"`);
      expect(v.message).toContain('https://github.com/o/r/actions/runs/100');
    },
  );

  it('says there is no bypass, and gives the rerun command for this run', () => {
    const v = ciVerdict([run({ conclusion: 'failure' })], SHA);
    expect(v.message).toMatch(/no bypass/);
    expect(v.message).toContain('gh run rerun 100 --failed');
    expect(v.message).toMatch(/fix it on main/);
  });

  it('refuses a completed run with no conclusion', () => {
    expect(ciVerdict([run({ conclusion: null })], SHA).state).toBe('failed');
  });
});

describe('a run that has not finished', () => {
  it.each(['queued', 'in_progress', 'waiting', 'requested', 'pending'])('reports %s as pending', (status) => {
    const v = ciVerdict([run({ status, conclusion: null })], SHA);
    expect(v).toMatchObject({ ok: false, state: 'pending' });
    expect(v.message).toMatch(/^CI still running for aaaaaaaaaa .* — wait for https:/);
  });

  it('a rerun in progress is pending, even though an earlier attempt concluded', () => {
    const v = ciVerdict([run({ status: 'in_progress', conclusion: null, run_attempt: 2 })], SHA);
    expect(v.state).toBe('pending');
  });
});

describe('the most recent run decides', () => {
  it('prefers the newest run over an older green one', () => {
    const older = run({ id: 1, created_at: '2026-09-27T09:00:00Z' });
    const newer = run({ id: 2, created_at: '2026-09-27T11:00:00Z', conclusion: 'failure' });
    expect(latestRun([older, newer]).id).toBe(2);
    expect(ciVerdict([older, newer], SHA).state).toBe('failed');
  });

  it('prefers a newer green run over an older red one', () => {
    const older = run({ id: 1, created_at: '2026-09-27T09:00:00Z', conclusion: 'cancelled' });
    const newer = run({ id: 2, created_at: '2026-09-27T11:00:00Z' });
    expect(ciVerdict([newer, older], SHA).ok).toBe(true);
  });

  it('breaks a created_at tie by run id', () => {
    expect(latestRun([run({ id: 5 }), run({ id: 9 }), run({ id: 7 })]).id).toBe(9);
  });

  it('relevantRuns keeps only push-to-main runs for the SHA', () => {
    const keep = run({ id: 3 });
    expect(relevantRuns([keep, run({ event: 'workflow_dispatch' })], SHA)).toEqual([keep]);
  });
});

describe('fetchCiRuns', () => {
  it('asks gh for ci.yml push runs on main for exactly this SHA, with no shell', () => {
    const exec = vi.fn(() => JSON.stringify({ total_count: 1, workflow_runs: [run()] }));
    const runs = fetchCiRuns(SHA, { exec });
    expect(runs).toHaveLength(1);
    const [cmd, args] = exec.mock.calls[0] as unknown as [string, string[]];
    expect(cmd).toBe('gh');
    expect(args[0]).toBe('api');
    expect(args[1]).toContain('actions/workflows/ci.yml/runs');
    expect(args[1]).toContain(`head_sha=${SHA}`);
    expect(args[1]).toContain('event=push');
    expect(args[1]).toContain('branch=main');
  });

  it('refuses — does not skip — when gh is not installed', () => {
    const exec = vi.fn(() => {
      throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
    });
    expect(() => fetchCiRuns(SHA, { exec })).toThrow(/not installed.*refused, not skipped/s);
  });

  it('refuses with an auth hint when gh fails', () => {
    const exec = vi.fn(() => {
      throw Object.assign(new Error('exit 4'), { status: 4, stderr: 'gh auth login required' });
    });
    expect(() => fetchCiRuns(SHA, { exec })).toThrow(/gh auth login/);
  });
});

describe('waitForVerdict', () => {
  const pending = run({ status: 'in_progress', conclusion: null });

  it('polls an in-progress run until it completes, then applies the verdict', async () => {
    const responses = [[pending], [pending], [run()]];
    const fetchRuns = vi.fn(() => responses.shift()!);
    const sleep = vi.fn(async () => {});
    const v = await waitForVerdict(SHA, { fetchRuns, sleep, now: () => 0, intervalMs: 10, timeoutMs: 1000 });
    expect(v.ok).toBe(true);
    expect(fetchRuns).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('applies a red verdict once the run completes red', async () => {
    const responses = [[pending], [run({ conclusion: 'failure' })]];
    const v = await waitForVerdict(SHA, {
      fetchRuns: () => responses.shift()!,
      sleep: async () => {},
      now: () => 0,
    });
    expect(v.state).toBe('failed');
  });

  it('does NOT wait for a missing run — fails on the first read', async () => {
    const fetchRuns = vi.fn(() => []);
    const sleep = vi.fn(async () => {});
    const v = await waitForVerdict(SHA, { fetchRuns, sleep });
    expect(v.state).toBe('missing');
    expect(fetchRuns).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('gives up at the cap and stays refused', async () => {
    let t = 0;
    const v = await waitForVerdict(SHA, {
      fetchRuns: () => [pending],
      sleep: async (ms: number) => {
        t += ms;
      },
      now: () => t,
      intervalMs: 60_000,
      timeoutMs: 30 * 60_000,
    });
    expect(v).toMatchObject({ ok: false, state: 'pending' });
    expect(v.message).toMatch(/gave up after 30 min/);
    expect(t).toBeLessThanOrEqual(30 * 60_000);
  });
});
