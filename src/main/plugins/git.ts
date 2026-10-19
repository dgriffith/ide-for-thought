/**
 * Installing a plugin from a git URL (#2634). The repository is someone
 * else's input, as an archive is (`zip.ts`), and gets the same rules:
 *
 * - **Public, over HTTPS, without credentials.** The URL is parsed the way a
 *   publish remote is (`git/remote-policy.ts`: SSH spellings rewritten to
 *   HTTPS, nothing else accepted, no user name or password in it), and no
 *   `onAuth` is ever passed, so neither the GitHub CLI token nor any other
 *   credential goes to a plugin's host. A private repository can be
 *   downloaded as a zip instead.
 * - **Bounded.** The download is capped in bytes on the wire and in time, so
 *   a huge or stalled repository is abandoned rather than filling memory.
 * - **Checked out by us, not by isomorphic-git.** The clone fetches without a
 *   checkout; `checkoutPluginTree` then walks the commit's tree one entry at
 *   a time and refuses the whole thing on an escaping or `.git` name, a link
 *   (isomorphic-git would write one), a submodule, too many entries, or a
 *   file or total over `ZIP_LIMITS`. Accepted risk: a blob is inflated in
 *   memory before its size is known, so one object compressed beyond the
 *   download cap's ratio costs memory before it's refused.
 *
 * A pin (`url#ref`) may be a tag, a branch or a commit; the commit actually
 * installed is recorded either way.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import git, { Errors, type GitHttpRequest, type HttpClient } from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import { normalizeRemoteToHttps } from '../git/remote-policy';
import { unsafeName, ZIP_LIMITS } from './zip';

export const GIT_LIMITS = {
  /** Bytes received from the server, all requests together. */
  downloadBytes: 25 * 1024 * 1024,
  timeoutMs: 120_000,
};

export interface GitPluginSpec {
  /** The HTTPS URL fetched. */
  url: string;
  /** A tag, branch or commit; absent for the default branch. */
  ref?: string;
}

const SHA = /^[0-9a-f]{7,40}$/i;
const REF = /^[A-Za-z0-9._/-]+$/;

/**
 * `https://host/owner/repo[.git][#ref]`, or an SSH spelling of one. Throws a
 * user-facing message for anything else.
 */
export function parseGitPluginSpec(raw: string): GitPluginSpec {
  const trimmed = raw.trim();
  const hash = trimmed.lastIndexOf('#');
  const address = hash === -1 ? trimmed : trimmed.slice(0, hash);
  const ref = hash === -1 ? undefined : trimmed.slice(hash + 1);
  const normalized = normalizeRemoteToHttps(address);
  if (!URL.canParse(normalized)) throw new Error(`"${address}" isn't a git repository URL.`);
  const url = new URL(normalized);
  if (url.protocol !== 'https:') {
    throw new Error(`Plugins are installed over https:// only; "${address}" uses ${url.protocol.replace(/:$/, '')}.`);
  }
  if (url.username || url.password) {
    throw new Error('Remove the user name or password from the URL; plugins are installed from public repositories without signing in.');
  }
  if (url.search) throw new Error(`"${address}" has a query string; give the repository's own URL.`);
  if (ref !== undefined && (!REF.test(ref) || ref.startsWith('-') || ref.split('/').some((s) => s === '' || s === '.' || s === '..'))) {
    throw new Error(`"${ref}" isn't a tag, branch or commit name.`);
  }
  return ref ? { url: url.href, ref } : { url: url.href };
}

/**
 * `base`, with every request bound to `abort` and every response body counted
 * against one `maxBytes` budget. Past it, the body throws and `abort` fires.
 * isomorphic-git's ref-advertisement reader swallows a body's error (it reads
 * as an empty response), so the overrun is also kept: `overrun()` is the
 * error to report, whatever the clone threw instead.
 */
export function boundedHttp(base: HttpClient, maxBytes: number, abort: AbortController): HttpClient & { overrun(): Error | null } {
  let received = 0;
  let overrun: Error | null = null;
  return {
    overrun: () => overrun,
    async request(req: GitHttpRequest) {
      // The timeout is enforced here rather than trusted to the transport: one
      // that ignores `signal`, or is handed it after it already fired, would
      // otherwise wait forever.
      const res = await untilAborted(base.request({ ...req, signal: abort.signal }), abort.signal);
      const body = res.body;
      if (!body) return res;
      async function* counted(): AsyncIterableIterator<Uint8Array> {
        const chunks = body![Symbol.asyncIterator]();
        for (;;) {
          const next = await untilAborted(chunks.next(), abort.signal);
          if (next.done) return;
          const chunk = next.value;
          received += chunk.byteLength;
          if (received > maxBytes) {
            overrun ??= new Error(`The repository is over ${Math.round(maxBytes / 1024 / 1024)} MB to download, more than a plugin may be.`);
            abort.abort();
            throw overrun;
          }
          yield chunk;
        }
      }
      return { ...res, body: counted() };
    },
  };
}

/** `work`, or a rejection as soon as `signal` aborts, including if it already has. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    work.catch(() => {}); // settles unobserved
    return Promise.reject(new Error('aborted'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
      (e: unknown) => { signal.removeEventListener('abort', onAbort); reject(e instanceof Error ? e : new Error(String(e))); },
    );
  });
}

/**
 * Fetch `spec` into `repoDir` without checking anything out, and resolve the
 * commit to install. `transport` is for tests.
 */
export async function fetchPluginRepo(
  spec: GitPluginSpec,
  repoDir: string,
  transport: HttpClient = http,
  limits = GIT_LIMITS,
): Promise<string> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), limits.timeoutMs);
  timer.unref?.();
  const client = boundedHttp(transport, limits.downloadBytes, abort);
  const pinnedCommit = spec.ref !== undefined && SHA.test(spec.ref);
  try {
    await git.clone({
      fs,
      http: client,
      dir: repoDir,
      url: spec.url,
      noCheckout: true,
      // A commit can only be found by fetching the branches that hold it;
      // anything else needs only its own tip. `noTags` only without a pin:
      // it hides the tag a pin names (with `singleBranch`, only that tag
      // comes down anyway).
      ...(pinnedCommit ? {} : { ref: spec.ref, singleBranch: true, depth: 1, noTags: spec.ref === undefined }),
    });
    if (pinnedCommit) {
      const oid = await git.expandOid({ fs, dir: repoDir, oid: spec.ref!.toLowerCase() });
      await git.readCommit({ fs, dir: repoDir, oid }); // a commit, not some other object
      return oid;
    }
    const [head] = await git.log({ fs, dir: repoDir, ref: 'HEAD', depth: 1 });
    if (!head) throw new Error(`${spec.url} has no commits.`);
    return head.oid;
  } catch (e) {
    const overrun = client.overrun();
    if (overrun) throw overrun;
    if (abort.signal.aborted) {
      throw new Error(`Fetching ${spec.url} took more than ${Math.round(limits.timeoutMs / 1000)} seconds, so it was stopped.`, { cause: e });
    }
    if (e instanceof Errors.HttpError) {
      throw new Error(
        `Couldn't read a public git repository at ${spec.url} (HTTP ${e.data.statusCode}). ` +
          'Plugins are installed from public repositories without signing in; for a private one, download it as a zip and choose Install from zip….',
        { cause: e },
      );
    }
    if (spec.ref && (e instanceof Errors.NotFoundError || e instanceof Errors.AmbiguousError)) {
      throw new Error(`"${spec.ref}" isn't a tag, branch or commit in ${spec.url}.`, { cause: e });
    }
    throw new Error(`Couldn't fetch ${spec.url}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  } finally {
    clearTimeout(timer);
  }
}

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

/**
 * Write `commit`'s tree from the repository at `repoDir` into `dest`, one
 * entry at a time, refusing the whole tree on the first unsafe entry (see the
 * header). On a throw `dest` may hold a partial checkout, which the caller's
 * staging cleanup removes.
 */
export async function checkoutPluginTree(repoDir: string, commit: string, dest: string, limits = ZIP_LIMITS): Promise<void> {
  const root = path.resolve(dest);
  await fsp.mkdir(root, { recursive: true });
  let count = 0;
  let total = 0;
  await git.walk({
    fs,
    dir: repoDir,
    trees: [git.TREE({ ref: commit })],
    // One entry at a time: the limits are checked as it goes, and only one
    // blob is in memory at once.
    iterate: async (walk, children) => {
      const out = [];
      for (const child of children) out.push(await walk(child));
      return out;
    },
    map: async (name, [entry]) => {
      if (name === '.' || !entry) return true;
      if (++count > limits.entries) throw new Error(`It has more than ${limits.entries} files and folders, the most a plugin may have.`);
      const bad = unsafeName(name);
      if (bad) throw new Error(`"${name}" ${bad}; the repository can't be installed safely.`);
      if (name.split('/').some((s) => s.toLowerCase() === '.git')) throw new Error(`"${name}" is inside a ".git" folder; the repository can't be installed safely.`);
      const target = path.resolve(root, ...name.split('/'));
      if (!target.startsWith(root + path.sep)) throw new Error(`"${name}" would land outside the plugin folder.`);

      const type = await entry.type();
      if (type === 'tree') {
        await fsp.mkdir(target, { recursive: true });
        return true;
      }
      if (type === 'commit') throw new Error(`"${name}" is a submodule; a plugin holds plain files only.`);
      if (type !== 'blob') throw new Error(`"${name}" isn't a plain file.`);
      if (((await entry.mode()) & S_IFMT) === S_IFLNK) throw new Error(`"${name}" is a link; a plugin holds plain files only.`);
      const content = (await entry.content()) ?? new Uint8Array();
      if (content.byteLength > limits.fileBytes) {
        throw new Error(`"${name}" is ${mb(content.byteLength)}; one file may be at most ${mb(limits.fileBytes)}.`);
      }
      total += content.byteLength;
      if (total > limits.totalBytes) throw new Error(`It's more than ${mb(limits.totalBytes)}, the most a plugin may be.`);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      // `wx`: never write through something already there.
      await fsp.writeFile(target, content, { flag: 'wx' });
      return true;
    },
  });
}
