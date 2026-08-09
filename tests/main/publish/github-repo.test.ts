/**
 * @vitest-environment node
 *
 * GitHub repo + Pages provisioning (#254 follow-on).
 *
 * `fetch` is stubbed, so these pin the parts that are ours rather than
 * GitHub's: which endpoint a creation goes to (user vs org), that Pages
 * already-on is a success and not an error, that a subdirectory Pages can't
 * serve is refused up front, and — most importantly — that each HTTP status
 * turns into a message naming the actual problem. A token that can push but
 * can't create is the failure users will actually hit, and "403" alone doesn't
 * tell them to go add a scope.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseGitHubRepo,
  repoSlug,
  checkRepoExists,
  createRepo,
  enablePages,
  getPagesUrl,
  pagesPathForSubdir,
} from '../../../src/main/git/github-repo';

interface Call { url: string; method: string; body: unknown }

let calls: Call[] = [];
/** Queue of responses, consumed in order. */
let queue: Array<{ status: number; body?: unknown }> = [];

function respond(): Response {
  const next = queue.shift() ?? { status: 500 };
  const ok = next.status >= 200 && next.status < 300;
  return {
    ok,
    status: next.status,
    statusText: String(next.status),
    json: async () => next.body ?? {},
  } as unknown as Response;
}

beforeEach(() => {
  calls = [];
  queue = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    return Promise.resolve(respond());
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('parseGitHubRepo', () => {
  it('reads owner/repo from the forms a user might paste', () => {
    expect(parseGitHubRepo('https://github.com/dave/notes.git')).toEqual({ owner: 'dave', repo: 'notes' });
    expect(parseGitHubRepo('https://github.com/dave/notes')).toEqual({ owner: 'dave', repo: 'notes' });
    expect(parseGitHubRepo('https://github.com/dave/notes/')).toEqual({ owner: 'dave', repo: 'notes' });
    expect(repoSlug({ owner: 'dave', repo: 'notes' })).toBe('dave/notes');
  });

  it('returns null for anything that is not a plain github.com repo', () => {
    // The signal that means "leave this target alone" — a GitLab or Codeberg
    // remote still pushes fine, it just gets no provisioning.
    expect(parseGitHubRepo('https://gitlab.com/dave/notes.git')).toBeNull();
    expect(parseGitHubRepo('https://codeberg.org/dave/notes')).toBeNull();
    expect(parseGitHubRepo('https://github.example.com/dave/notes')).toBeNull();
    expect(parseGitHubRepo('https://github.com/dave')).toBeNull();
    expect(parseGitHubRepo('https://github.com/dave/notes/tree/main')).toBeNull();
    expect(parseGitHubRepo('not a url')).toBeNull();
  });
});

describe('checkRepoExists', () => {
  const ref = { owner: 'dave', repo: 'notes' };

  it('reads 200 as exists and 404 as missing', async () => {
    queue = [{ status: 200 }];
    expect(await checkRepoExists('tok', ref)).toBe('exists');
    queue = [{ status: 404 }];
    expect(await checkRepoExists('tok', ref)).toBe('missing');
    expect(calls[0]!.url).toBe('https://api.github.com/repos/dave/notes');
  });

  it('separates a bad token from a missing repo', async () => {
    queue = [{ status: 401 }];
    await expect(checkRepoExists('tok', ref)).rejects.toThrow(/rejected the token/i);
  });
});

describe('createRepo', () => {
  it('creates under the token account via /user/repos', async () => {
    queue = [{ status: 200, body: { login: 'dave' } }, { status: 201 }];
    await createRepo('tok', { owner: 'dave', repo: 'notes' }, { private: false });

    expect(calls[1]!.url).toBe('https://api.github.com/user/repos');
    expect(calls[1]!.method).toBe('POST');
    expect(calls[1]!.body).toMatchObject({ name: 'notes', private: false, auto_init: false });
  });

  it('creates under an organization when the owner is not the token account', async () => {
    queue = [{ status: 200, body: { login: 'dave' } }, { status: 201 }];
    await createRepo('tok', { owner: 'acme-corp', repo: 'notes' }, { private: true });

    expect(calls[1]!.url).toBe('https://api.github.com/orgs/acme-corp/repos');
    expect(calls[1]!.body).toMatchObject({ private: true });
  });

  it('matches the login case-insensitively', async () => {
    queue = [{ status: 200, body: { login: 'Dave' } }, { status: 201 }];
    await createRepo('tok', { owner: 'dave', repo: 'notes' }, { private: false });
    expect(calls[1]!.url).toBe('https://api.github.com/user/repos');
  });

  it('says a token that can push may still not be able to create', async () => {
    queue = [{ status: 200, body: { login: 'dave' } }, { status: 403 }];
    await expect(createRepo('tok', { owner: 'dave', repo: 'notes' }, { private: false }))
      .rejects.toThrow(/`repo` scope; a fine-grained one needs Administration: write/);
  });

  it('names the owner GitHub could not find', async () => {
    queue = [{ status: 200, body: { login: 'dave' } }, { status: 404 }];
    await expect(createRepo('tok', { owner: 'ghost-org', repo: 'notes' }, { private: false }))
      .rejects.toThrow(/"ghost-org"/);
  });

  it('reports a name collision as such', async () => {
    queue = [{ status: 200, body: { login: 'dave' } }, { status: 422 }];
    await expect(createRepo('tok', { owner: 'dave', repo: 'notes' }, { private: false }))
      .rejects.toThrow(/may already exist/);
  });
});

describe('enablePages', () => {
  const ref = { owner: 'dave', repo: 'notes' };

  it('points Pages at the branch and returns the site URL', async () => {
    queue = [{ status: 201, body: { html_url: 'https://dave.github.io/notes/' } }];
    const url = await enablePages('tok', ref, { branch: 'gh-pages', path: '/' });

    expect(url).toBe('https://dave.github.io/notes/');
    expect(calls[0]!.url).toBe('https://api.github.com/repos/dave/notes/pages');
    expect(calls[0]!.body).toEqual({ source: { branch: 'gh-pages', path: '/' } });
  });

  it('treats already-enabled (409) as fine and reads the URL back', async () => {
    queue = [{ status: 409 }, { status: 200, body: { html_url: 'https://dave.github.io/notes/' } }];
    expect(await enablePages('tok', ref, { branch: 'gh-pages', path: '/' }))
      .toBe('https://dave.github.io/notes/');
  });

  it('explains a 403 as scope-or-paid-plan rather than leaving a bare status', async () => {
    queue = [{ status: 403 }];
    await expect(enablePages('tok', ref, { branch: 'gh-pages', path: '/' }))
      .rejects.toThrow(/Pages: write.*paid GitHub plan/s);
  });

  it('getPagesUrl stays quiet when Pages is off', async () => {
    queue = [{ status: 404 }];
    expect(await getPagesUrl('tok', ref)).toBeNull();
  });
});

describe('pagesPathForSubdir', () => {
  it('maps the two locations Pages can serve', () => {
    expect(pagesPathForSubdir('')).toBe('/');
    expect(pagesPathForSubdir(undefined)).toBe('/');
    expect(pagesPathForSubdir('.')).toBe('/');
    expect(pagesPathForSubdir('docs')).toBe('/docs');
    expect(pagesPathForSubdir('/docs/')).toBe('/docs');
  });

  it('refuses a subdirectory Pages cannot serve, rather than guessing', () => {
    // Publishing into `site/` is a perfectly valid git push — it just can't be
    // wired to Pages, and the caller says so instead of enabling the wrong path.
    expect(pagesPathForSubdir('site')).toBeNull();
    expect(pagesPathForSubdir('public/web')).toBeNull();
  });
});
