/**
 * Adversarial thoughtbase generator (#2372).
 *
 * The thoughtbase directory is not trusted content — it arrives by zip
 * import, git clone and folder sync (see `src/main/path-containment.ts`'s
 * threat model). Every fixture the suite had before this one was a tidy
 * directory of well-formed UTF-8 markdown, which is why symlink escapes
 * (#2357, #2398), a corrupt `llm-settings.json` (#2356) and a corrupt
 * `secrets.json` (#2369) each shipped and were each fixed without a shared
 * way to reproduce the next one.
 *
 * This builds the hostile tree AT TEST TIME rather than committing it under
 * `tests/fixtures/`: symlinks do not survive git on every platform, a
 * several-MB note has no business in the repo, and the long-path case has to
 * be sized against the real temp dir the test landed in.
 *
 * Corrupt JSON settings files (the H1 / #2356 shape) are not part of the
 * tree — `llm-settings.json` lives in userData — so `CORRUPT_JSON_VARIANTS` /
 * `writeCorruptJson` below build those for whichever file a test points at.
 *
 * Every hostile input is a separately selectable `HostileFeature`, so a test
 * can build exactly the one it is about, or `ALL_HOSTILE_FEATURES` to check
 * that one bad file does not take the rest of the thoughtbase down with it.
 * Two well-formed control notes are ALWAYS written, so "the valid notes still
 * indexed" is assertable in every test.
 *
 * Each note carries a unique lowercase marker word (`manifest.markers`) that
 * the full-text index can be queried for, which is how a test tells "indexed"
 * from "skipped" without depending on how a title was derived.
 *
 * POSIX only: symlink creation needs privileges on Windows, and the
 * long-path limits below are the macOS / Linux ones. The suite runs on
 * macOS and Linux.
 *
 * Lifecycle: `buildHostileThoughtbase` only writes files; pair it with
 * `useTempDir` / `useGraphProject` from `./temp-project` for teardown.
 * `useHostileThoughtbase` does that pairing for the common fs-only case.
 */
import { beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { useTempDir } from './temp-project';

export const SYMLINK_FEATURES = [
  'symlink-file-outside',
  'symlink-dir-outside',
  'symlink-in-root',
  'symlink-dangling',
  'symlink-loop',
] as const;

export const ENCODING_FEATURES = [
  'invalid-utf8',
  'utf8-bom',
  'cesu-surrogate',
  'nul-bytes',
  'crlf-frontmatter',
] as const;

export const PATH_FEATURES = ['long-path', 'long-filename'] as const;

export const NAME_FEATURES = ['nfc-nfd-pair', 'special-chars', 'emoji-name', 'case-pair'] as const;

export const CONTENT_FEATURES = [
  'empty-note',
  'huge-single-line',
  'fm-unterminated',
  'fm-yaml-throws',
  'fm-alias-bomb',
] as const;

/**
 * Permission-denied entries. Skipped (not built) when running as root, where
 * mode bits do not stop a read. `unreadable-dir` has to be restored before the
 * temp dir can be removed — `useHostileThoughtbase` does that, and a caller
 * building by hand must call `restoreHostilePermissions`.
 */
export const PERMISSION_FEATURES = ['unreadable-note', 'unreadable-dir'] as const;

export const MINERVA_FEATURES = ['corrupt-config', 'corrupt-graph', 'corrupt-source-meta'] as const;

export type HostileFeature =
  | (typeof SYMLINK_FEATURES)[number]
  | (typeof ENCODING_FEATURES)[number]
  | (typeof PATH_FEATURES)[number]
  | (typeof NAME_FEATURES)[number]
  | (typeof CONTENT_FEATURES)[number]
  | (typeof PERMISSION_FEATURES)[number]
  | (typeof MINERVA_FEATURES)[number];

export const ALL_HOSTILE_FEATURES: readonly HostileFeature[] = [
  ...SYMLINK_FEATURES,
  ...ENCODING_FEATURES,
  ...PATH_FEATURES,
  ...NAME_FEATURES,
  ...CONTENT_FEATURES,
  ...PERMISSION_FEATURES,
  ...MINERVA_FEATURES,
];

/** Everything a note-walking subsystem sees; excludes `.minerva/` corruption. */
export const NOTE_TREE_FEATURES: readonly HostileFeature[] = ALL_HOSTILE_FEATURES.filter(
  (f) => !(MINERVA_FEATURES as readonly string[]).includes(f),
);

/** The two well-formed notes written into every hostile thoughtbase. */
export const CONTROL_NOTES = {
  alpha: 'control/alpha.md',
  beta: 'control/beta.md',
} as const;

/**
 * The string planted in the file OUTSIDE the root that the symlinks point at.
 * If it shows up in any index, something read through an escaping link.
 */
export const OUTSIDE_SECRET = 'outsidesecretzq2372';

/** Size of the `huge-single-line` note's one line (bytes, ASCII). */
export const HUGE_LINE_BYTES = 3 * 1024 * 1024;

/** Filesystem facts discovered while building, for platform-dependent asserts. */
export interface FsFacts {
  /** `Case.md` and `case.md` are two different files. False on default APFS / HFS+. */
  caseSensitive: boolean;
  /** NFC `café.md` and NFD `café.md` are two different files. False on APFS. */
  normalizationSensitive: boolean;
  /** The PATH_MAX the long-path case was sized against, or null when unsupported. */
  pathMax: number | null;
  /** Mode bits deny reads to this process (false as root). */
  permissionsEnforced: boolean;
}

export interface HostileManifest {
  root: string;
  outside: string;
  /**
   * Root-relative paths (native separators) each feature created INSIDE the
   * root. Absent key = feature not selected. For symlink features it is the
   * link itself; for `.minerva` corruption it is the corrupted file.
   */
  paths: Partial<Record<HostileFeature, string[]>>;
  /** Unique lowercase search token per note path, for full-text asserts. */
  markers: Record<string, string>;
  fs: FsFacts;
}

export interface BuildOptions {
  /** Directory the escaping symlinks point into. Must be OUTSIDE `root`. */
  outside: string;
  /** Defaults to every feature. */
  features?: readonly HostileFeature[];
}

const MAX_NAME_BYTES = 255;

function pathMaxFor(platform: NodeJS.Platform): number | null {
  if (platform === 'darwin') return 1024;
  if (platform === 'linux') return 4096;
  return null;
}

/** True when `a` and `b` name the same file on this filesystem. */
function namesCollide(dir: string, a: string, b: string): boolean {
  const probeA = path.join(dir, a);
  fs.writeFileSync(probeA, 'probe');
  try {
    return fs.existsSync(path.join(dir, b));
  } finally {
    fs.rmSync(probeA, { force: true });
  }
}

function probeFs(root: string): FsFacts {
  const dir = path.join(root, '.fs-probe');
  fs.mkdirSync(dir, { recursive: true });
  try {
    return {
      caseSensitive: !namesCollide(dir, 'Probe.txt', 'probe.txt'),
      normalizationSensitive: !namesCollide(dir, 'café.txt', 'café.txt'),
      pathMax: pathMaxFor(process.platform),
      permissionsEnforced: process.getuid?.() !== 0,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Write the hostile thoughtbase into `root` (which must exist). Returns what
 * was created and what the filesystem turned out to allow.
 */
export function buildHostileThoughtbase(root: string, opts: BuildOptions): HostileManifest {
  const features = new Set(opts.features ?? ALL_HOSTILE_FEATURES);
  const outside = opts.outside;
  const manifest: HostileManifest = {
    root,
    outside,
    paths: {},
    markers: {},
    fs: probeFs(root),
  };

  const record = (feature: HostileFeature, rel: string) => {
    (manifest.paths[feature] ??= []).push(rel);
  };
  const write = (rel: string, content: string | Buffer, marker?: string) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    if (marker) manifest.markers[rel] = marker;
  };

  // ── Controls (always) ────────────────────────────────────────────────────
  write(CONTROL_NOTES.alpha, '---\ntitle: Alpha Control\n---\n# Alpha\n\nalphamarker body #controltag\n', 'alphamarker');
  write(CONTROL_NOTES.beta, '# Beta Control\n\nbetamarker links to [[alpha]]\n', 'betamarker');

  // ── Symlinks ─────────────────────────────────────────────────────────────
  const needsOutside = features.has('symlink-file-outside') || features.has('symlink-dir-outside');
  if (needsOutside) {
    fs.mkdirSync(path.join(outside, 'secret-dir'), { recursive: true });
    fs.writeFileSync(path.join(outside, 'secret.md'), `# Outside\n\n${OUTSIDE_SECRET}\n`);
    fs.writeFileSync(path.join(outside, 'secret-dir', 'inner.md'), `# Inner\n\n${OUTSIDE_SECRET}\n`);
  }
  if (features.has('symlink-file-outside')) {
    const rel = path.join('links', 'escape-file.md');
    fs.mkdirSync(path.join(root, 'links'), { recursive: true });
    fs.symlinkSync(path.join(outside, 'secret.md'), path.join(root, rel));
    record('symlink-file-outside', rel);
  }
  if (features.has('symlink-dir-outside')) {
    const rel = path.join('links', 'escape-dir');
    fs.mkdirSync(path.join(root, 'links'), { recursive: true });
    fs.symlinkSync(path.join(outside, 'secret-dir'), path.join(root, rel));
    record('symlink-dir-outside', rel);
  }
  if (features.has('symlink-in-root')) {
    write(path.join('links', 'target.md'), '# Link Target\n\ninrootmarker\n', 'inrootmarker');
    const rel = path.join('links', 'in-root-alias.md');
    // Relative target: the common shape `ln -s` leaves behind.
    fs.symlinkSync('target.md', path.join(root, rel));
    manifest.markers[rel] = 'inrootmarker';
    record('symlink-in-root', rel);
  }
  if (features.has('symlink-dangling')) {
    const rel = path.join('links', 'dangling.md');
    fs.mkdirSync(path.join(root, 'links'), { recursive: true });
    // In-root target that does not exist: contained, so no walker skips it
    // as an escape — the read itself has to cope with ENOENT.
    fs.symlinkSync('does-not-exist.md', path.join(root, rel));
    record('symlink-dangling', rel);
  }
  if (features.has('symlink-loop')) {
    fs.mkdirSync(path.join(root, 'links'), { recursive: true });
    const a = path.join('links', 'loop-a.md');
    const b = path.join('links', 'loop-b.md');
    fs.symlinkSync('loop-b.md', path.join(root, a));
    fs.symlinkSync('loop-a.md', path.join(root, b));
    // A directory that links to its own parent: a walker that follows
    // directory links recurses forever.
    const self = path.join('links', 'self-dir');
    fs.symlinkSync('.', path.join(root, self));
    record('symlink-loop', a);
    record('symlink-loop', b);
    record('symlink-loop', self);
  }

  // ── Encoding ─────────────────────────────────────────────────────────────
  if (features.has('invalid-utf8')) {
    const rel = path.join('encoding', 'invalid-utf8.md');
    write(rel, Buffer.concat([
      Buffer.from('# Invalid Bytes\n\ninvalidutf8marker '),
      // Truncated 2-byte seq, lone continuation bytes, bad 4-byte lead.
      Buffer.from([0xc3, 0x28, 0x20, 0xa0, 0xa1, 0x20, 0xf0, 0x28, 0x8c, 0xbc, 0x20, 0xff]),
      Buffer.from(' tail\n'),
    ]), 'invalidutf8marker');
    record('invalid-utf8', rel);
  }
  if (features.has('utf8-bom')) {
    const rel = path.join('encoding', 'bom.md');
    write(rel, Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('---\ntitle: Bom Frontmatter Title\n---\n# Bom Heading\n\nbommarker\n'),
    ]), 'bommarker');
    record('utf8-bom', rel);
  }
  if (features.has('cesu-surrogate')) {
    const rel = path.join('encoding', 'cesu.md');
    // U+D800 encoded as if it were a scalar (CESU-8 / WTF-8): ED A0 80.
    write(rel, Buffer.concat([
      Buffer.from('# Cesu Note\n\ncesumarker '),
      Buffer.from([0xed, 0xa0, 0x80]),
      Buffer.from(' end\n'),
    ]), 'cesumarker');
    record('cesu-surrogate', rel);
  }
  if (features.has('nul-bytes')) {
    const rel = path.join('encoding', 'nul.md');
    write(rel, Buffer.from('# Nul Note\n\nnulmarker a\0b\0\0c [[alpha]]\n'), 'nulmarker');
    record('nul-bytes', rel);
  }
  if (features.has('crlf-frontmatter')) {
    const rel = path.join('encoding', 'crlf.md');
    write(rel, '---\r\ntitle: Crlf Frontmatter Title\r\n---\r\n# Crlf Heading\r\n\r\ncrlfmarker\r\n', 'crlfmarker');
    record('crlf-frontmatter', rel);
  }

  // ── Long paths ───────────────────────────────────────────────────────────
  if (features.has('long-filename')) {
    // Exactly NAME_MAX bytes including the extension.
    const rel = path.join('long', 'n'.repeat(MAX_NAME_BYTES - 3) + '.md');
    write(rel, '# Long Filename\n\nlongnamemarker\n', 'longnamemarker');
    record('long-filename', rel);
  }
  if (features.has('long-path') && manifest.fs.pathMax !== null) {
    // Sized against the CANONICAL root: the app realpaths the root (macOS
    // tmpdir is /var → /private/var), so a path at the limit under the
    // spelling it was handed would already be over it once canonicalised.
    // A 64-byte margin leaves room for the app's own sibling paths.
    const realRoot = fs.realpathSync(root);
    const leaf = 'deep-note.md';
    const budget = manifest.fs.pathMax - 1 - 64 - realRoot.length - 1 - leaf.length;
    const segs: string[] = [];
    let used = 0;
    while (used + 201 <= budget) { segs.push('d'.repeat(200)); used += 201; }
    const rest = budget - used - 1;
    if (rest > 0) segs.push('e'.repeat(rest));
    const rel = path.join(...segs, leaf);
    write(rel, '# Deep Note\n\nlongpathmarker\n', 'longpathmarker');
    record('long-path', rel);
  }

  // ── Unusual names ────────────────────────────────────────────────────────
  if (features.has('nfc-nfd-pair')) {
    const nfc = path.join('names', 'café.md');
    const nfd = path.join('names', 'café.md');
    write(nfc, '# Cafe NFC\n\nnfcmarker\n', 'nfcmarker');
    record('nfc-nfd-pair', nfc);
    if (manifest.fs.normalizationSensitive) {
      write(nfd, '# Cafe NFD\n\nnfdmarker\n', 'nfdmarker');
      record('nfc-nfd-pair', nfd);
    }
  }
  if (features.has('special-chars')) {
    const names = ['with space.md', 'hash#tag.md', 'percent%20enc.md', 'question?.md'];
    names.forEach((n, i) => {
      const rel = path.join('names', n);
      write(rel, `# Special ${i}\n\nspecialmarker${i}\n`, `specialmarker${i}`);
      record('special-chars', rel);
    });
  }
  if (features.has('emoji-name')) {
    const rel = path.join('names', '\u{1F9E0} brain \u{1F468}‍\u{1F469}‍\u{1F467}.md');
    write(rel, '# Emoji Note\n\nemojimarker\n', 'emojimarker');
    record('emoji-name', rel);
  }
  if (features.has('case-pair')) {
    const upper = path.join('names', 'CaseNote.md');
    const lower = path.join('names', 'casenote.md');
    write(upper, '# Upper Case\n\nuppercasemarker\n', 'uppercasemarker');
    record('case-pair', upper);
    // On a case-insensitive fs the second write would silently replace the
    // first's bytes under the first's name; build what the fs can hold.
    if (manifest.fs.caseSensitive) {
      write(lower, '# Lower Case\n\nlowercasemarker\n', 'lowercasemarker');
      record('case-pair', lower);
    }
  }

  // ── Content ──────────────────────────────────────────────────────────────
  if (features.has('empty-note')) {
    const rel = path.join('content', 'empty.md');
    write(rel, '');
    record('empty-note', rel);
  }
  if (features.has('huge-single-line')) {
    const rel = path.join('content', 'huge.md');
    const filler = 'lorem ipsum '.repeat(Math.ceil(HUGE_LINE_BYTES / 12)).slice(0, HUGE_LINE_BYTES);
    write(rel, `hugemarker ${filler}`, 'hugemarker');
    record('huge-single-line', rel);
  }
  if (features.has('fm-unterminated')) {
    const rel = path.join('content', 'fm-unterminated.md');
    write(rel, '---\ntitle: Never Closed\ntags: [a, b]\n\n# Unterminated Heading\n\nunterminatedmarker\n', 'unterminatedmarker');
    record('fm-unterminated', rel);
  }
  if (features.has('fm-yaml-throws')) {
    const rel = path.join('content', 'fm-throws.md');
    write(rel, '---\ntitle: [unclosed\nkey: : : bad\n\t- tab indent\n---\n# Throws Heading\n\nyamlthrowsmarker\n', 'yamlthrowsmarker');
    record('fm-yaml-throws', rel);
  }
  if (features.has('fm-alias-bomb')) {
    const rel = path.join('content', 'fm-bomb.md');
    const lines = ['title: Bomb Title', 'a0: &a0 ["lol","lol","lol","lol","lol","lol","lol","lol","lol"]'];
    for (let i = 1; i < 9; i++) lines.push(`a${i}: &a${i} [${Array(9).fill(`*a${i - 1}`).join(',')}]`);
    write(rel, `---\n${lines.join('\n')}\n---\n# Bomb Heading\n\nbombmarker\n`, 'bombmarker');
    record('fm-alias-bomb', rel);
  }

  // ── Permissions ──────────────────────────────────────────────────────────
  if (features.has('unreadable-note') && manifest.fs.permissionsEnforced) {
    const rel = path.join('perms', 'unreadable.md');
    write(rel, '# Unreadable\n\nunreadablemarker\n');
    fs.chmodSync(path.join(root, rel), 0o000);
    record('unreadable-note', rel);
  }
  if (features.has('unreadable-dir') && manifest.fs.permissionsEnforced) {
    const rel = path.join('perms', 'locked');
    write(path.join(rel, 'inside.md'), '# Inside Locked\n\nlockedmarker\n');
    fs.chmodSync(path.join(root, rel), 0o000);
    record('unreadable-dir', rel);
  }

  // ── .minerva corruption ──────────────────────────────────────────────────
  if (features.has('corrupt-config')) {
    const rel = path.join('.minerva', 'config.json');
    write(rel, '{"baseUri": "https://example.test/tb/", "displayName": ');
    record('corrupt-config', rel);
  }
  if (features.has('corrupt-graph')) {
    const rel = path.join('.minerva', 'graph.ttl');
    // Mentions "proposal" so the #2216 skip-parse shortcut can't avoid it.
    write(rel, '@prefix tho: <https://minerva.dev/ontology/thought#> .\n<urn:x:proposal/1> a tho:Proposal ;\n  tho:broken "unterminated literal ;\n<<< not turtle >>>\n');
    record('corrupt-graph', rel);
  }
  if (features.has('corrupt-source-meta')) {
    const rel = path.join('.minerva', 'sources', 'broken-source', 'meta.ttl');
    write(rel, 'this: a thought:Article ;\n  dc:title "Unclosed ;\n  !!! garbage\n');
    // A healthy sibling, so "one bad source doesn't hide the others" is checkable.
    write(path.join('.minerva', 'sources', 'good-source', 'meta.ttl'), 'this: a thought:Article ;\n  dc:title "Good Source Title" .\n');
    record('corrupt-source-meta', rel);
  }

  return manifest;
}

/**
 * Give back read/list permission on everything the permission features
 * locked, so the tree can be deleted. Idempotent; safe on a partial build.
 */
export function restoreHostilePermissions(manifest: HostileManifest): void {
  for (const rel of manifest.paths['unreadable-dir'] ?? []) {
    fs.chmodSync(path.join(manifest.root, rel), 0o755);
  }
  for (const rel of manifest.paths['unreadable-note'] ?? []) {
    fs.chmodSync(path.join(manifest.root, rel), 0o644);
  }
}

/**
 * Corrupt JSON settings files (#2356 / H1), by the way they go bad in the
 * wild: a crash mid-write, a sync conflict, a hand edit, a stray encoder.
 * None of these is a JSON object, so a strict read-modify-write reader must
 * refuse every one of them rather than merge a patch over "empty".
 */
export const CORRUPT_JSON_VARIANTS = {
  /** A crash mid-write: the object is cut off after a key that held secrets. */
  truncated: Buffer.from('{"providers": {"anthropic": {"apiKey": "enc:v1:abc'),
  /** Not JSON at all — a hand edit, or a sync tool's conflict marker. */
  garbage: Buffer.from('<<<<<<< HEAD\n{"model": "a"}\n=======\n{"model": "b"}\n>>>>>>> theirs\n'),
  /** Zero bytes: `open(O_TRUNC)` landed and the write did not. */
  empty: Buffer.alloc(0),
  /** Valid JSON, wrong shape. */
  'json-null': Buffer.from('null'),
  'json-array': Buffer.from('[{"apiKey": "sk-ant-x"}]'),
  'json-string': Buffer.from('"sk-ant-x"'),
  // Deliberately absent: invalid UTF-8 inside a string VALUE. A `utf-8`
  // read decodes it to U+FFFD and the object parses, so it is a readable
  // (lossy) file, not a corrupt one — a strict reader correctly accepts it.
  /** A NUL-padded tail, as some filesystems leave after a power cut. */
  'nul-padded': Buffer.concat([Buffer.from('{"model": "claude'), Buffer.alloc(64)]),
} as const satisfies Record<string, Buffer>;

export type CorruptJsonVariant = keyof typeof CORRUPT_JSON_VARIANTS;

export const CORRUPT_JSON_VARIANT_NAMES = Object.keys(CORRUPT_JSON_VARIANTS) as CorruptJsonVariant[];

/** Write one corrupt variant to `absPath` (creating its directory) and return its bytes. */
export function writeCorruptJson(absPath: string, variant: CorruptJsonVariant): Buffer {
  const bytes = CORRUPT_JSON_VARIANTS[variant];
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, bytes);
  return bytes;
}

/** POSIX-separated form of a manifest path, as the graph and search store them. */
export function posix(rel: string): string {
  return rel.split(path.sep).join('/');
}

/**
 * fs-only lifecycle: a fresh temp dir per test holding `tb/` (the
 * thoughtbase) and `outside/` (what the escaping links point at) as
 * siblings, built with `features`, torn down by `useTempDir`.
 */
export function useHostileThoughtbase(
  features: readonly HostileFeature[] = ALL_HOSTILE_FEATURES,
  prefix = 'minerva-hostile-',
): { readonly manifest: HostileManifest } {
  const base = useTempDir(prefix);
  let manifest: HostileManifest | undefined;
  // Registered AFTER useTempDir's teardown, so under vitest's default
  // `sequence.hooks: 'stack'` it runs FIRST: a locked directory has to be
  // unlocked before the recursive delete can list it.
  afterEach(() => {
    if (manifest) restoreHostilePermissions(manifest);
    manifest = undefined;
  });
  beforeEach(() => {
    const root = path.join(base.root, 'tb');
    const outside = path.join(base.root, 'outside');
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    manifest = buildHostileThoughtbase(root, { outside, features });
  });
  return {
    get manifest() {
      if (!manifest) throw new Error('useHostileThoughtbase: accessed manifest outside a test');
      return manifest;
    },
  };
}
