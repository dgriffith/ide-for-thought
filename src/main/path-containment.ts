/**
 * Thoughtbase path containment (#2357, #2398).
 *
 * The one implementation of "does this path really live inside the
 * thoughtbase root?" — lexically AND after following symlinks. It used to
 * live in `notebase/fs.ts`, which is still where every guarded file op
 * calls it (`notebaseFs` re-exports `assertSafePath`). It moved here because
 * the bulk walkers that read the whole tree without going through
 * `notebaseFs` — the graph indexer, the search index, the embeddings
 * backfill — need the same answer, and `graph/` may not import `notebase/`
 * (#2238, `tests/architecture/no-package-cycles.test.ts`).
 *
 * Why a loose file under `src/main/` rather than `src/shared/` or a new
 * package: `src/shared` is lint-enforced free of Node builtins (#668) and
 * this is all `fs`/`path`; and `no-package-cycles` deliberately treats loose
 * `src/main/*.ts` leaves (`project-context-types.ts`, `secret-storage.ts`)
 * as importable by every package. This module imports nothing from the app,
 * so it cannot close a cycle. (Its one import, `shared/ignored-dirs`, is a
 * pure leaf.)
 *
 * It also holds the agent-path guard (#2453): `assertSafePath` answers
 * "inside the root?", and `agentPathRefusal` / `assertAgentPath` add "and not
 * in `.minerva/` or another hidden folder, as spelled or after symlinks" —
 * the check every path a model or MCP agent chose goes through.
 */
import fsSync from 'node:fs';
import path from 'node:path';
import { hasIgnoredSegment } from '../shared/ignored-dirs';

/** The one error `assertSafePath` throws. Callers and tests match on it. */
const PATH_TRAVERSAL = 'Path traversal detected';

/**
 * Best-effort realpath: returns the canonicalised path when the prefix
 * exists, falling back to the input when it doesn't (so projects can
 * still be checked before they're created).
 */
function realPathSafe(p: string): string {
  try {
    return fsSync.realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Memo for `realPathSafe(rootPath)` (#2216).
 *
 * `assertSafePath` runs on every file IPC — 24 call sites, several inside
 * loops — and boot walks the whole project three to four times. The syscall
 * dominates: measured at 16.25us against 17.22us for the whole of
 * `assertSafePath`, i.e. **94% of the guard's cost is canonicalising a path
 * that cannot change**. At 2,000 notes that is ~34ms per full pass, paid
 * several times over before the window paints, and again on every save.
 *
 * Deliberately a small fixed-size ring rather than a `Map` keyed by rootPath,
 * for two reasons that pull the same way:
 *
 *   - `assertSafePath` is called for roots that are NOT open projects — the
 *     comment below notes it must work before a project exists — so a
 *     per-project slot would be allocated by a read. #2240 is explicit that a
 *     read must not allocate a slot, having been bitten by exactly that.
 *   - A rootPath-keyed collection is per-project state and owes someone a
 *     teardown (`tests/architecture/project-state-registered.test.ts`). This
 *     owes nobody anything: it is bounded, it self-evicts, and dropping an
 *     entry costs one syscall.
 *
 * Four entries covers several windows open on different projects; beyond that
 * it degrades to today's behaviour rather than to a wrong answer.
 *
 * SOUNDNESS: the cached value is the canonical path of the project root. It
 * goes stale only if the root itself is replaced by a different directory or
 * symlink while the app holds it open — at which point the user has swapped
 * the thoughtbase under a running editor, and a stale realpath is the least
 * of it. The traversal check this feeds is about a RELATIVE path escaping the
 * root, and that check is unchanged.
 */
const REAL_ROOT_CACHE_SIZE = 4;
const realRootCache: Array<{ root: string; real: string }> = [];

function realRoot(rootPath: string): string {
  const hit = realRootCache.find((e) => e.root === rootPath);
  if (hit) return hit.real;
  const real = realPathSafe(rootPath);
  realRootCache.unshift({ root: rootPath, real });
  if (realRootCache.length > REAL_ROOT_CACHE_SIZE) realRootCache.pop();
  return real;
}

/** Drop the memo. Exported for tests that move a root between symlink
 *  endpoints; production never needs it. */
export function _clearRealRootCacheForTests(): void {
  realRootCache.length = 0;
}

/**
 * Containment guard for every thoughtbase file operation. Returns the
 * absolute path to hand to `fs.*`, or throws `Path traversal detected`.
 *
 * THREAT MODEL (#2357). The thoughtbase directory is NOT trusted content:
 * it arrives by zip import, git clone and folder sync, and its relative
 * paths reach this function from the renderer and from LLM tools
 * (`read_note`, `fetch_properties`, …) whose arguments a prompt injection
 * can choose. So the guarantee is about where the bytes actually live, not
 * about how the path is spelled: **no path accepted here reads or writes
 * outside the realpath of the root.** Two ways out are closed:
 *
 *   1. Lexical escape — `../x`, an absolute path. Caught by resolving
 *      against the realpath'd root and checking the prefix.
 *   2. Symlink escape — `notes/link → ~/.ssh`, then `notes/link/id_rsa`.
 *      Lexically inside, but `fs.readFile`/`writeFile` follow the link.
 *      Caught by `assertNoSymlinkEscape`, which canonicalises the part of
 *      the path that exists and re-checks the prefix. A dangling link is
 *      resolved by hand, because a write FOLLOWS a dangling link and
 *      creates its target.
 *
 * Symlinks that stay inside the root keep working, and the root itself may
 * be a symlink (#352: macOS's /var → /private/var, where tmpdir() lives) —
 * both are the realpath'd-root case. An escaping symlink is refused in
 * every operation, including rename/delete of the link itself: deleting
 * one is left to Finder rather than special-cased here.
 *
 * NOT covered: a race where a component is swapped for a symlink between
 * this check and the `fs.*` call (TOCTOU). Closing that needs
 * `O_NOFOLLOW`/`openat`-style descriptor walking, which Node doesn't
 * expose; the attacker would need live write access to the thoughtbase
 * while the app runs, which is outside this model.
 *
 * The return value is the lexical resolution against the realpath'd root
 * (for an in-root symlink it still names the path THROUGH the link), same
 * as before #2357, so callers' path arithmetic is unchanged.
 */
export function assertSafePath(rootPath: string, relativePath: string): string {
  const root = realRoot(rootPath);
  const resolved = path.resolve(root, relativePath);
  if (!isWithin(root, resolved)) {
    throw new Error(PATH_TRAVERSAL);
  }
  assertNoSymlinkEscape(root, resolved);
  return resolved;
}

function isWithin(root: string, p: string): boolean {
  return p === root || p.startsWith(root + path.sep);
}

/**
 * Walk `resolved` down from the (canonical) root with one `lstat` per
 * component, and only if a component turns out to be a symlink pay for a
 * full canonicalisation. `assertSafePath` is hot — every file IPC, several
 * inside loops — and measured on macOS an `lstat` is ~1.2us against ~13us
 * for `realpath`, so the common no-symlink case costs ~1us per path segment
 * below the root and never calls `realpathSync` (which keeps #2216's
 * "one realpath per root" property intact).
 *
 * The walk stops at the first component that doesn't exist: nothing below
 * it can be a link, which is what makes write-to-create (leaf and any
 * intermediate dirs missing) work. Any other `lstat` failure (ENOTDIR,
 * EACCES) also stops it — the `fs.*` call can't get past that component
 * either, so there is nothing further for it to follow.
 */
function assertNoSymlinkEscape(root: string, resolved: string): void {
  if (resolved === root) return;
  const parts = resolved.slice(root.length + 1).split(path.sep);
  let cur = root;
  for (let i = 0; i < parts.length; i++) {
    cur = cur + path.sep + parts[i];
    let st: fsSync.Stats | undefined;
    try {
      st = fsSync.lstatSync(cur, { throwIfNoEntry: false });
    } catch {
      return;
    }
    if (st === undefined) return;
    if (st.isSymbolicLink()) {
      // Everything from here down is resolved in one go: canonicalise the
      // whole remaining path (chains, links-to-links, dangling links) and
      // check where it really lands.
      if (!isWithin(root, canonicalizeExisting(resolved))) {
        throw new Error(PATH_TRAVERSAL);
      }
      return;
    }
  }
}

/** Linux's MAXSYMLINKS; a chain longer than this is a loop (or hostile). */
const MAX_SYMLINK_HOPS = 40;

/**
 * `realpath` for a path whose tail may not exist: canonicalise the deepest
 * existing ancestor and re-append the missing components. If the first
 * missing component is itself a (dangling) symlink, follow it by hand —
 * `fs.writeFile` on a dangling link creates the link's TARGET, so its
 * target is where a write would land. Only reached when a symlink is
 * actually on the path, so its cost is off the hot path.
 */
function canonicalizeExisting(abs: string, hops = 0): string {
  if (hops > MAX_SYMLINK_HOPS) {
    // Can't prove where it lands; the fs call would ELOOP anyway.
    throw new Error(PATH_TRAVERSAL);
  }
  const tail: string[] = [];
  let existing = abs;
  for (;;) {
    let real: string;
    try {
      real = fsSync.realpathSync(existing);
    } catch {
      const parent = path.dirname(existing);
      if (parent === existing) return abs;
      tail.unshift(path.basename(existing));
      existing = parent;
      continue;
    }
    if (tail.length === 0) return real;
    const next = path.join(real, tail[0]!);
    let st: fsSync.Stats | undefined;
    try {
      st = fsSync.lstatSync(next, { throwIfNoEntry: false });
    } catch {
      st = undefined;
    }
    if (st?.isSymbolicLink()) {
      const target = path.resolve(real, fsSync.readlinkSync(next));
      return canonicalizeExisting(path.join(target, ...tail.slice(1)), hops + 1);
    }
    return path.join(real, ...tail);
  }
}

/**
 * The canonical (realpath'd, memoized) form of a thoughtbase root — the
 * directory every containment check measures against. The watcher watches
 * this rather than the spelling it was handed, because with
 * `followSymlinks: false` chokidar treats a symlinked root as a single link
 * and never descends into it (#2398).
 */
export function canonicalRoot(rootPath: string): string {
  return realRoot(rootPath);
}

/**
 * For bulk directory walkers (#2398): true when `entry`, found by `readdir`
 * at `fullPath` somewhere under `rootPath`, is a symlink whose target lies
 * outside the root — i.e. reading it would pull bytes from outside the
 * thoughtbase into the graph, the search index or the embeddings, where the
 * LLM's search tools can reach them.
 *
 * The walkers visit thousands of entries, so the common case must cost
 * nothing: the `readdir` dirent already says whether the entry is a link,
 * and a non-link is answered without a syscall. Only an actual link pays
 * for `assertSafePath`'s canonicalisation. The walkers never descend into a
 * symlinked directory (its dirent is not `isDirectory()`), so the leaf is
 * the only component below the root that can be a link.
 *
 * A dangling link counts as escaping when its target would be outside the
 * root (the same rule `assertSafePath` applies to a write), and as contained
 * otherwise — the read then fails with ENOENT exactly as it did before.
 *
 * Silent by design: `listFiles` calls it on every sidebar refresh. A caller
 * that wants to tell the user a file was skipped logs it itself.
 */
export function isEscapingSymlink(
  rootPath: string,
  fullPath: string,
  entry: { isSymbolicLink(): boolean },
): boolean {
  if (!entry.isSymbolicLink()) return false;
  return !isContainedPath(rootPath, fullPath);
}

/**
 * Non-throwing `assertSafePath` for an ABSOLUTE path built from `rootPath`
 * (as the walkers build theirs). Costs an `lstat` per component below the
 * root, so a walker holding a dirent should prefer `isEscapingSymlink`,
 * which skips it for non-links.
 */
export function isContainedPath(rootPath: string, absPath: string): boolean {
  try {
    assertSafePath(rootPath, path.relative(rootPath, absPath));
    return true;
  } catch (e) {
    // Only the guard's own verdict means "not contained"; anything else is a
    // bug and should surface rather than read as a quiet skip.
    if (e instanceof Error && e.message === PATH_TRAVERSAL) return false;
    throw e;
  }
}

// ── Agent-chosen paths (#2453) ──────────────────────────────────────────────

/**
 * Why {@link agentPathRefusal} refused a path: `hidden` — it names, or really
 * lands in, a hidden or ignored folder (`.minerva/`, `.git/`, `node_modules/`,
 * any dot-segment); `outside` — {@link assertSafePath} refused it; `root` — it
 * names the thoughtbase root itself (`.`, `notes/..`).
 */
export type AgentPathRefusal = 'hidden' | 'outside' | 'root';

/** Thrown by {@link assertAgentPath}; `reason` says which rule fired. */
export class AgentPathRefusedError extends Error {
  constructor(readonly relativePath: string, readonly reason: AgentPathRefusal) {
    super(
      reason === 'hidden'
        ? `Refused: "${relativePath}" is inside a hidden or Minerva-internal folder (such as .minerva/), ` +
          'which the assistant cannot read or target. Use the note paths that search_notes, ' +
          'grep_notes and list_notes return.'
        : reason === 'root'
          ? `Refused: "${relativePath}" is the thoughtbase root itself, not a note or folder inside it.`
          : `Refused: "${relativePath}" is not a path inside the thoughtbase.`,
    );
    this.name = 'AgentPathRefusedError';
  }
}

/** `hasIgnoredSegment`, case-folded: the default macOS volume is
 *  case-insensitive, so `NODE_MODULES/x` opens `node_modules/x`. A dot segment
 *  is refused whatever its case, so `.MINERVA/` is caught without folding. */
function hasHiddenSegment(relativePath: string): boolean {
  return hasIgnoredSegment(relativePath.toLowerCase());
}

/**
 * The one check for a thoughtbase path an AGENT chose (#2453) — the in-app
 * model's tool arguments and an external MCP client's alike. Returns `null`
 * when the path is fine, or why it is refused. Three rules, each needed:
 *
 *   1. **As spelled** — no segment the listing walkers skip (`isIgnoredEntry`:
 *      any dot-prefixed name, `node_modules`), so `.minerva/secrets.json`,
 *      `./.minerva/x`, `notes/../.minerva/x` and `.git/config` are refused
 *      before the disk is touched. `..` is itself a dot segment, so every
 *      traversal spelling is refused here too.
 *   2. **{@link assertSafePath}** — inside the realpath of the root.
 *   3. **Where it really lands** — an in-root symlink into `.minerva/`
 *      (`notes/x.json → ../.minerva/secrets.json`) passes rule 2 by design
 *      (#2357: in-root links keep working), so the canonical path, relative to
 *      the canonical root, must pass rule 1 as well. This covers a WRITE
 *      target whose tail does not exist yet: `canonicalizeExisting` resolves
 *      the deepest existing ancestor, so `notes/link/new.md` with
 *      `notes/link → ../.minerva` lands in `.minerva/new.md` and is refused.
 *
 * Why: `.minerva/` holds conversation transcripts, `secrets.json`, the
 * proposal store, type definitions and templates. No listing, index or search
 * walks it, so an agent never finds a path there legitimately; a planted
 * instruction in a shared note is how a model comes to ask for one.
 *
 * Paths Minerva builds itself (`.minerva/sources/<id>/body.md` in
 * `read_source`, `.minerva/types/<id>.md` in the `type-def` apply) do not come
 * through here; the agent-supplied id spliced into them goes through
 * {@link assertBareId}.
 *
 * NOT for the user's own input: `minerva read`, the renderer's file IPC and
 * the Query panel keep full in-root access.
 */
export function agentPathRefusal(rootPath: string, relativePath: string): AgentPathRefusal | null {
  if (hasHiddenSegment(relativePath)) return 'hidden';
  let resolved: string;
  try {
    resolved = assertSafePath(rootPath, relativePath);
  } catch (e) {
    if (e instanceof Error && e.message === PATH_TRAVERSAL) return 'outside';
    throw e;
  }
  let root: string;
  let real: string;
  try {
    // Both sides canonicalised the same way: a root that does not exist yet
    // (realRoot falls back to its spelling) still has a canonical ancestor —
    // `/tmp/x` lands in `/private/tmp/x` on macOS.
    root = canonicalizeExisting(realRoot(rootPath));
    real = canonicalizeExisting(resolved);
  } catch (e) {
    if (e instanceof Error && e.message === PATH_TRAVERSAL) return 'outside';
    throw e;
  }
  // The root itself is never a note or a folder an agent may act on: `.` as a
  // folder to delete or move would take `.minerva/` with it.
  if (real === root) return 'root';
  if (!isWithin(root, real)) return 'outside';
  return hasHiddenSegment(path.relative(root, real)) ? 'hidden' : null;
}

/**
 * Throwing form of {@link agentPathRefusal}: returns the absolute path
 * (`assertSafePath`'s answer) or throws {@link AgentPathRefusedError}. An
 * empty or non-string path is refused as `outside`.
 */
export function assertAgentPath(rootPath: string, relativePath: string): string {
  if (typeof relativePath !== 'string' || relativePath.trim() === '') {
    throw new AgentPathRefusedError(String(relativePath ?? ''), 'outside');
  }
  const why = agentPathRefusal(rootPath, relativePath);
  if (why) throw new AgentPathRefusedError(relativePath, why);
  return path.resolve(realRoot(rootPath), relativePath);
}

/**
 * An identifier an agent supplied that Minerva splices into a path it builds
 * itself — a source id in `.minerva/sources/<id>/…`. It must be one segment
 * and not a dot segment, or `../conversations` walks out of the directory
 * Minerva meant (#2453). Returns the id or throws, naming `label`.
 */
export function assertBareId(id: string, label = 'id'): string {
  if (
    typeof id !== 'string' || id === '' || id === '.' ||
    id.includes('/') || id.includes('\\') || id.includes('..') || id.includes('\0')
  ) {
    throw new Error(`Invalid ${label} "${String(id)}": expected a bare identifier, not a path.`);
  }
  return id;
}
