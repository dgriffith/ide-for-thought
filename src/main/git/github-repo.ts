/**
 * GitHub repository + Pages provisioning for the Publish destination (#1560
 * follow-on / #254).
 *
 * The push side (`publish-git.ts`) already creates the BRANCH when it's absent:
 * a clone of a missing ref falls back to `git init` on that branch and the push
 * creates it remotely. What the git protocol can't do is create the repository
 * itself, or switch Pages on — both are REST calls, so they live here.
 *
 * Deliberately narrow: `fetch` against api.github.com, no SDK, no Electron
 * import, every function taking an explicit token so the whole thing is
 * testable with a stubbed `fetch`.
 *
 * Everything here is GitHub-specific, while a publish target is a generic git
 * remote — GitLab and Codeberg remotes push perfectly well today. `parseGitHubRepo`
 * returning null is the "not GitHub, leave it alone" signal, and callers must
 * honour it rather than assuming every remote is a GitHub one.
 */

const API = 'https://api.github.com';

export interface GitHubRepoRef {
  owner: string;
  repo: string;
}

/** Pages can only serve from the repo root or `/docs` — no other path. */
export type PagesPath = '/' | '/docs';

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'User-Agent': 'Minerva',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/**
 * `owner`/`repo` from a GitHub remote URL, or null for any other host. Accepts
 * the HTTPS form this app normalizes to; anything with extra path segments
 * (a gist, an enterprise instance, a raw URL) is rejected rather than guessed at.
 */
export function parseGitHubRepo(remoteUrl: string): GitHubRepoRef | null {
  let url: URL;
  try {
    url = new URL(remoteUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return null;
  const parts = url.pathname.replace(/^\/+/, '').replace(/\/+$/, '').split('/');
  if (parts.length !== 2) return null;
  const [owner, rawRepo] = parts as [string, string];
  const repo = rawRepo.replace(/\.git$/i, '');
  if (!owner || !repo) return null;
  return { owner, repo };
}

/** Human-readable `owner/repo`. */
export function repoSlug(ref: GitHubRepoRef): string {
  return `${ref.owner}/${ref.repo}`;
}

/**
 * Does the repo exist and can this token see it?
 *
 * `missing` deliberately means "GitHub answered 404", which covers both "no
 * such repo" and "a private repo this token can't see" — GitHub does not
 * distinguish them, and pretending otherwise would produce a confident wrong
 * message. The caller's prompt says "doesn't exist (or isn't visible to your
 * token)" for that reason.
 */
export async function checkRepoExists(
  token: string,
  ref: GitHubRepoRef,
): Promise<'exists' | 'missing'> {
  const res = await fetch(`${API}/repos/${ref.owner}/${ref.repo}`, { headers: headers(token) });
  if (res.ok) return 'exists';
  if (res.status === 404) return 'missing';
  if (res.status === 401) throw new Error('GitHub rejected the token (invalid or expired).');
  throw new Error(`GitHub returned ${res.status} ${res.statusText} looking up ${repoSlug(ref)}.`);
}

/** The authenticated user's login, for deciding user-repo vs org-repo creation. */
async function authenticatedLogin(token: string): Promise<string> {
  const res = await fetch(`${API}/user`, { headers: headers(token) });
  if (!res.ok) {
    throw new Error(`Couldn't identify the token's GitHub account (${res.status} ${res.statusText}).`);
  }
  const body = (await res.json()) as { login?: string };
  if (!body.login) throw new Error("GitHub didn't report a login for this token.");
  return body.login;
}

/**
 * Create the repository. Routes to `POST /user/repos` when the owner IS the
 * token's account and `POST /orgs/{owner}/repos` otherwise — creating under
 * someone else's personal account is impossible, and that failure comes back
 * from the org endpoint with GitHub's own wording.
 */
export async function createRepo(
  token: string,
  ref: GitHubRepoRef,
  opts: { private: boolean; description?: string },
): Promise<void> {
  const login = await authenticatedLogin(token);
  const isOwnAccount = login.toLowerCase() === ref.owner.toLowerCase();
  const url = isOwnAccount ? `${API}/user/repos` : `${API}/orgs/${ref.owner}/repos`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: ref.repo,
      private: opts.private,
      // No README/licence commit: the publish push writes the first commit, and
      // an auto-init commit on the default branch would just be litter.
      auto_init: false,
      ...(opts.description ? { description: opts.description } : {}),
    }),
  });
  if (res.ok) return;

  // A token that can PUSH may still not be able to CREATE — different scope —
  // so say which, rather than reporting a generic failure.
  if (res.status === 403) {
    throw new Error(
      `The GitHub token can't create repositories for ${ref.owner}. A classic token needs the ` +
        '`repo` scope; a fine-grained one needs Administration: write.',
    );
  }
  if (res.status === 404) {
    throw new Error(
      `GitHub couldn't find an account or organization called "${ref.owner}" that this token may ` +
        'create repositories in.',
    );
  }
  if (res.status === 422) {
    throw new Error(`GitHub rejected the name "${repoSlug(ref)}" — it may already exist.`);
  }
  throw new Error(`Creating ${repoSlug(ref)} failed: ${res.status} ${res.statusText}.`);
}

/**
 * Point Pages at `branch`/`path` and return the site URL.
 *
 * Called AFTER the first push — Pages rejects a source branch that doesn't
 * exist yet. Already-enabled (409) is a success: we read the existing config
 * back so the caller still gets a URL to show.
 */
export async function enablePages(
  token: string,
  ref: GitHubRepoRef,
  opts: { branch: string; path: PagesPath },
): Promise<string | null> {
  const res = await fetch(`${API}/repos/${ref.owner}/${ref.repo}/pages`, {
    method: 'POST',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: { branch: opts.branch, path: opts.path } }),
  });
  if (res.ok) {
    const body = (await res.json()) as { html_url?: string };
    return body.html_url ?? null;
  }
  if (res.status === 409) return getPagesUrl(token, ref);
  if (res.status === 403) {
    throw new Error(
      'GitHub refused to enable Pages. A fine-grained token needs Pages: write, and Pages on a ' +
        'private repository requires a paid GitHub plan.',
    );
  }
  throw new Error(`Enabling GitHub Pages failed: ${res.status} ${res.statusText}.`);
}

/** The live Pages URL, or null when Pages isn't configured. Never throws. */
export async function getPagesUrl(token: string, ref: GitHubRepoRef): Promise<string | null> {
  try {
    const res = await fetch(`${API}/repos/${ref.owner}/${ref.repo}/pages`, { headers: headers(token) });
    if (!res.ok) return null;
    const body = (await res.json()) as { html_url?: string };
    return body.html_url ?? null;
  } catch {
    return null;
  }
}

/**
 * The Pages `path` for an export subdirectory, or null when Pages can't serve
 * it. Pages supports only the repo root and `/docs`; a target publishing into
 * `site/` is perfectly valid as a git push but can't be auto-configured, and
 * the caller says so instead of silently enabling the wrong thing.
 */
export function pagesPathForSubdir(subdir: string | undefined): PagesPath | null {
  const clean = (subdir ?? '').replace(/^[./]+/, '').replace(/\/+$/, '');
  if (!clean) return '/';
  if (clean.toLowerCase() === 'docs') return '/docs';
  return null;
}
