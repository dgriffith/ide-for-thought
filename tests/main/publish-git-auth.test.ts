/**
 * GitHub auth resolution + token check (#1508).
 *
 * `resolveGitHubToken` precedence: a preferred (stored) token → `gh auth token`
 * → GH_TOKEN/GITHUB_TOKEN env → throw. `checkGitHubToken` validates via
 * GET /user, resolving the same fallback chain, and never throws.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ execFileSync: vi.fn() }));
vi.mock('node:child_process', () => ({ execFileSync: h.execFileSync }));

import { resolveGitHubToken, checkGitHubToken } from '../../src/main/git/publish-git';

const GH_ABSENT = () => { throw new Error('gh not found'); };

// process.env is worker-global, so snapshot + restore to avoid leaking the
// deletions into other test files that share the worker.
const envSnapshot = { GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN };

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const [k, v] of Object.entries(envSnapshot)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('resolveGitHubToken — precedence', () => {
  it('prefers the passed (stored) token, without invoking gh', () => {
    h.execFileSync.mockImplementation(() => 'gh-token');
    expect(resolveGitHubToken('  stored-token  ')).toBe('stored-token');
    expect(h.execFileSync).not.toHaveBeenCalled();
  });

  it('falls back to the gh CLI when no stored token', () => {
    h.execFileSync.mockReturnValue('gh-token\n');
    expect(resolveGitHubToken()).toBe('gh-token');
  });

  it('falls back to the env var when gh is unavailable', () => {
    h.execFileSync.mockImplementation(GH_ABSENT);
    process.env.GH_TOKEN = 'env-token';
    expect(resolveGitHubToken()).toBe('env-token');
  });

  it('throws a configuration message when nothing is available', () => {
    h.execFileSync.mockImplementation(GH_ABSENT);
    expect(() => resolveGitHubToken()).toThrow(/aren't configured/i);
  });
});

describe('checkGitHubToken', () => {
  it('reports ok on a 200 from GET /user', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200 })));
    expect(await checkGitHubToken('ghp_x')).toEqual({ ok: true });
  });

  it('maps 401 to an invalid-token message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, statusText: 'Unauthorized' })));
    const r = await checkGitHubToken('ghp_bad');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/invalid or expired/i);
  });

  it('short-circuits when there is no token to check', async () => {
    h.execFileSync.mockImplementation(GH_ABSENT);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await checkGitHubToken();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no token/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
