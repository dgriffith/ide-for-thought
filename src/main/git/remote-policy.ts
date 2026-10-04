/**
 * Which credentials a publish remote may receive (#2556).
 *
 * A git target's `gitRemote` lives in `.minerva/config.json`, which travels
 * with the thoughtbase, so the URL is not the user's own statement of where
 * their credentials should go. Two rules hold whatever it says:
 *
 *  - **HTTPS only.** An `http://` remote would carry the token in the clear;
 *    any other scheme isomorphic-git can't push to. SSH spellings are
 *    rewritten to HTTPS first (`normalizeRemoteToHttps`), as before.
 *  - **Ambient GitHub credentials go to github.com only.** The `gh auth token`
 *    and `GH_TOKEN`/`GITHUB_TOKEN` are the user's GitHub identity, not a
 *    per-target secret; a remote on any other host gets them never. A token
 *    stored on the target itself may go to that target's host, once this
 *    machine has approved the URL (`publish/remote-approvals.ts`).
 *
 * Hosts are compared from the parsed URL, so `https://github.com@evil.example/`
 * is `evil.example`, as it is to the transport.
 */

/** The only hosts the gh-CLI / env token is ever sent to. */
export const AMBIENT_TOKEN_HOSTS: ReadonlySet<string> = new Set(['github.com', 'www.github.com']);

/** Rewrite an SSH remote URL to its HTTPS equivalent (isomorphic-git can't do
 *  SSH). HTTP(S) URLs pass through untouched — `parsePublishRemote` decides
 *  whether they're allowed. */
export function normalizeRemoteToHttps(url: string): string {
  const trimmed = url.trim();
  const scp = trimmed.match(/^git@([^:]+):(.+)$/); // scp-like: git@host:owner/repo.git
  if (scp) return `https://${scp[1]}/${scp[2]}`;
  const ssh = trimmed.match(/^ssh:\/\/(?:git@)?([^/]+)\/(.+)$/);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  return trimmed;
}

/**
 * Parse a target's remote into the URL credentials would be sent to. Throws a
 * user-facing message for anything but HTTPS.
 */
export function parsePublishRemote(raw: string): URL {
  const normalized = normalizeRemoteToHttps(raw);
  if (!URL.canParse(normalized)) {
    throw new Error(`"${raw}" isn't a git remote URL Minerva can publish to.`);
  }
  const url = new URL(normalized);
  if (url.protocol === 'http:') {
    throw new Error(
      `Refusing to publish to ${url.host} over plain http:// — your credentials would be sent unencrypted. ` +
        'Use the https:// address of the repository instead.',
    );
  }
  if (url.protocol !== 'https:') {
    throw new Error(`Minerva publishes over https:// only; "${raw}" uses ${url.protocol.replace(/:$/, '')}.`);
  }
  if (url.username || url.password) {
    throw new Error('Remove the user name or password from the remote URL — Minerva supplies credentials itself.');
  }
  return url;
}

/** `parsePublishRemote(raw).href`, or null where it would throw. */
export function publishRemoteHref(raw: string): string | null {
  const normalized = normalizeRemoteToHttps(raw);
  if (!URL.canParse(normalized)) return null;
  const url = new URL(normalized);
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  return url.href;
}

/** May the gh-CLI / env GitHub token be sent to `url`? */
export function ambientTokenAllowed(url: URL): boolean {
  return AMBIENT_TOKEN_HOSTS.has(url.hostname.toLowerCase());
}
