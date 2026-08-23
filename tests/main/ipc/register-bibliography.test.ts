/**
 * @vitest-environment node
 *
 * Main-process coverage for `register-bibliography.ts` (#1840).
 *
 * Two jobs live in this registrar: choosing/importing CSL assets, and the one
 * handler that writes a note (`BIBLIOGRAPHY_GENERATE`). It drives the real
 * `registerBibliography()` with the write pipeline + CSL loaders mocked, and
 * pins:
 *
 *   - the #1631 guard, including the deliberate exception: the style PICKER
 *     answers with the bundled set when no project is open (the Settings
 *     dialog can be opened before any thoughtbase is), while every write
 *     throws;
 *   - `BIBLIOGRAPHY_SET_STYLE` refuses an id that isn't in the merged
 *     registry — including inherited `Object.prototype` keys, which is what
 *     `hasOwnProperty.call` is there for;
 *   - the import handlers validate the file's CONTENT (not just its
 *     extension) before copying it into the project, and a cancelled picker
 *     writes nothing;
 *   - the remove handlers reject an id that could escape the CSL directory —
 *     these two build a path by interpolation, so the regex IS the guard;
 *   - `BIBLIOGRAPHY_GENERATE` writes through the history-aware pipeline under
 *     a named cause, and doesn't write at all when nothing changed.
 *
 * The pure CSL helpers (`isValidCslStyle`, `deriveStyleId`, …) are kept real —
 * stubbing them would make the validation tests assert their own mocks. Only
 * the filesystem-reading loaders are replaced.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ROOT = '/vault';
/** What `rootPathFromEvent` reports; null models "no project open". */
let openProject: string | null = ROOT;

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  win: { id: 1, isDestroyed: vi.fn(() => false), webContents: { send: vi.fn() } },
  // electron / node
  showOpenDialog: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  unlink: vi.fn(),
  // csl registry
  getMergedStyles: vi.fn(),
  loadUserStyles: vi.fn(),
  loadUserLocales: vi.fn(),
  // project config
  getBibliographyStyleId: vi.fn(),
  setBibliographyStyleId: vi.fn(),
  // note write path
  notebaseReadFile: vi.fn(),
  generateBibliography: vi.fn(),
  writeAndReindex: vi.fn(),
  runWithHistorySource: vi.fn(<T>(_s: unknown, fn: () => Promise<T>) => fn()),
  renderInlineCitations: vi.fn(),
  // call-order log
  order: [] as string[],
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => { h.handlers.set(channel, fn); } },
  dialog: { showOpenDialog: h.showOpenDialog },
}));

vi.mock('node:fs/promises', () => {
  const api = { readFile: h.readFile, writeFile: h.writeFile, mkdir: h.mkdir, unlink: h.unlink };
  return { default: api, ...api };
});

vi.mock('../../../src/main/ipc/helpers', () => ({
  rootPathFromEvent: () => openProject,
  withRootPath:
    <A extends unknown[], R>(fn: (rootPath: string, ...a: A) => R) =>
      (_e: unknown, ...args: A): R => {
        if (!openProject) throw new Error('No project open');
        return fn(openProject, ...args);
      },
  withRootPathOr:
    <A extends unknown[], R>(fallback: R, fn: (rootPath: string, ...a: A) => R) =>
      (_e: unknown, ...args: A): R => (openProject ? fn(openProject, ...args) : fallback),
  withRootPathWin:
    <A extends unknown[], R>(fn: (rootPath: string, win: unknown, ...a: A) => R) =>
      (_e: unknown, ...args: A): R => {
        if (!openProject) throw new Error('No project open');
        return fn(openProject, h.win, ...args);
      },
  hooks: { HOOKS: true },
}));

// Partial mock: the fs-reading loaders are stubbed, the pure validators /
// id-derivers / directory constants stay real.
vi.mock('../../../src/main/publish/csl/user-assets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/publish/csl/user-assets')>();
  return {
    ...actual,
    getMergedStyles: h.getMergedStyles,
    loadUserStyles: h.loadUserStyles,
    loadUserLocales: h.loadUserLocales,
  };
});

vi.mock('../../../src/main/notebase/fs', () => ({ readFile: h.notebaseReadFile }));
vi.mock('../../../src/main/notebase/write-pipeline', () => ({ writeAndReindex: h.writeAndReindex }));
vi.mock('../../../src/main/history', () => ({ runWithHistorySource: h.runWithHistorySource }));
vi.mock('../../../src/main/bibliography/generate', () => ({ generateBibliography: h.generateBibliography }));
vi.mock('../../../src/main/citations/render-inline', () => ({ renderInlineCitations: h.renderInlineCitations }));
vi.mock('../../../src/main/project-config', () => ({
  getBibliographyStyleId: h.getBibliographyStyleId,
  setBibliographyStyleId: h.setBibliographyStyleId,
}));

import { registerBibliography } from '../../../src/main/ipc/register-bibliography';
import { Channels } from '../../../src/shared/channels';
import { DEFAULT_STYLE } from '../../../src/main/publish/csl/assets';
import { USER_STYLES_DIR, USER_LOCALES_DIR } from '../../../src/main/publish/csl/user-assets';

registerBibliography();

const call = (channel: string, ...args: unknown[]): unknown => h.handlers.get(channel)!({}, ...args);
const callAsync = (channel: string, ...args: unknown[]): Promise<unknown> =>
  Promise.resolve(call(channel, ...args));

/** A minimally-valid CSL style — the validator matches on the namespace. */
const STYLE_XML = '<style xmlns="http://purl.org/net/xbiblio/csl"><info><title>House Style</title></info></style>';
/** …and a locale. */
const LOCALE_XML = '<locale xmlns="http://purl.org/net/xbiblio/csl" xml:lang="en-GB"/>';

beforeEach(() => {
  vi.resetAllMocks();
  openProject = ROOT;
  h.order.length = 0;
  h.runWithHistorySource.mockImplementation(<T>(_s: unknown, fn: () => Promise<T>) => fn());
  h.getMergedStyles.mockResolvedValue({
    styles: { apa: '<x/>', ieee: '<x/>' },
    labels: { apa: 'APA', ieee: 'IEEE' },
    userIds: new Set<string>(),
  });
  h.loadUserStyles.mockResolvedValue([]);
  h.loadUserLocales.mockResolvedValue([]);
  // The fs writers are awaited (and `unlink` is `.catch`-ed), so they have to
  // hand back promises rather than the `undefined` a reset mock returns.
  h.mkdir.mockResolvedValue(undefined);
  h.writeFile.mockResolvedValue(undefined);
  h.unlink.mockResolvedValue(undefined);
});

describe('register-bibliography — the #1631 project guard', () => {
  const throwers: [string, unknown[]][] = [
    [Channels.BIBLIOGRAPHY_SET_STYLE, ['ieee']],
    [Channels.BIBLIOGRAPHY_GENERATE, ['notes/a.md']],
    [Channels.CSL_IMPORT_STYLE, []],
    [Channels.CSL_IMPORT_LOCALE, []],
    [Channels.CSL_REMOVE_STYLE, ['mine']],
    [Channels.CSL_REMOVE_LOCALE, ['en-GB']],
  ];

  it.each(throwers)('%s throws with no project open', (channel, args) => {
    openProject = null;
    expect(() => call(channel, ...args)).toThrow('No project open');
  });

  it('nothing is written, imported or unlinked when there is no project', () => {
    openProject = null;
    for (const [channel, args] of throwers) {
      try { call(channel, ...args); } catch { /* asserted above */ }
    }
    expect(h.setBibliographyStyleId).not.toHaveBeenCalled();
    expect(h.writeAndReindex).not.toHaveBeenCalled();
    expect(h.writeFile).not.toHaveBeenCalled();
    expect(h.unlink).not.toHaveBeenCalled();
    expect(h.showOpenDialog).not.toHaveBeenCalled();
  });

  // Each of these fallbacks is also the answer for a project that has simply
  // configured nothing — a legitimate value, not an error in disguise.
  const fallbacks: [string, unknown[], unknown][] = [
    [Channels.BIBLIOGRAPHY_GET_STYLE, [], DEFAULT_STYLE],
    [Channels.CSL_LIST_USER_STYLES, [], []],
    [Channels.CSL_LIST_USER_LOCALES, [], []],
    [Channels.CITATION_RENDER_INLINE, [[{ key: 'x' }]], { markers: [], bibliography: null, missing: [], styleId: DEFAULT_STYLE }],
  ];

  it.each(fallbacks)('%s answers with its empty value and no project', async (channel, args, expected) => {
    openProject = null;
    await expect(callAsync(channel, ...args)).resolves.toEqual(expected);
    expect(h.loadUserStyles).not.toHaveBeenCalled();
    expect(h.renderInlineCitations).not.toHaveBeenCalled();
  });

  it('CITATION_RENDER_INLINE\'s project-less answer is a fully-shaped response', async () => {
    // A partial object would make the preview renderer read `undefined.length`
    // — the fallback has to be a real empty answer, not a stub.
    openProject = null;
    const answer = await callAsync(Channels.CITATION_RENDER_INLINE, []) as Record<string, unknown>;
    expect(Object.keys(answer).sort()).toEqual(['bibliography', 'markers', 'missing', 'styleId']);
  });

  it('BIBLIOGRAPHY_LIST_STYLES still fills the picker with no project open', async () => {
    // The Settings dialog opens before a thoughtbase does in some flows; an
    // empty style picker there would look like a broken install.
    openProject = null;
    await expect(callAsync(Channels.BIBLIOGRAPHY_LIST_STYLES)).resolves.toEqual([
      { id: 'apa', label: 'APA', isUser: false },
      { id: 'ieee', label: 'IEEE', isUser: false },
    ]);
    // Honest note: the project-less branch asks for the merged registry at
    // rootPath `''`, so the user-style scan runs against a path relative to
    // the process CWD rather than being skipped outright. Harmless today (the
    // directory won't exist), pinned so a change is deliberate.
    expect(h.getMergedStyles).toHaveBeenCalledWith('');
  });
});

describe('register-bibliography — style selection', () => {
  it('BIBLIOGRAPHY_LIST_STYLES marks which entries came from the project', async () => {
    // The settings row only offers "remove" for user-imported styles, so this
    // flag is what keeps a bundled style from looking deletable.
    h.getMergedStyles.mockResolvedValue({
      styles: { apa: '<x/>', 'house-style': '<x/>' },
      labels: { apa: 'APA', 'house-style': 'House Style' },
      userIds: new Set(['house-style']),
    });

    await expect(callAsync(Channels.BIBLIOGRAPHY_LIST_STYLES)).resolves.toEqual([
      { id: 'apa', label: 'APA', isUser: false },
      { id: 'house-style', label: 'House Style', isUser: true },
    ]);
    expect(h.getMergedStyles).toHaveBeenCalledWith(ROOT);
  });

  it('BIBLIOGRAPHY_LIST_STYLES falls back to the id for a style with no title', async () => {
    h.getMergedStyles.mockResolvedValue({ styles: { odd: '<x/>' }, labels: {}, userIds: new Set(['odd']) });
    await expect(callAsync(Channels.BIBLIOGRAPHY_LIST_STYLES))
      .resolves.toEqual([{ id: 'odd', label: 'odd', isUser: true }]);
  });

  it('BIBLIOGRAPHY_GET_STYLE returns the project\'s configured style', () => {
    h.getBibliographyStyleId.mockReturnValue('ieee');
    expect(call(Channels.BIBLIOGRAPHY_GET_STYLE)).toBe('ieee');
    expect(h.getBibliographyStyleId).toHaveBeenCalledWith(ROOT);
  });

  it('BIBLIOGRAPHY_GET_STYLE falls back to the default when the project never chose one', () => {
    h.getBibliographyStyleId.mockReturnValue(null);
    expect(call(Channels.BIBLIOGRAPHY_GET_STYLE)).toBe(DEFAULT_STYLE);
  });

  it('BIBLIOGRAPHY_SET_STYLE stores a style that exists in the merged registry', async () => {
    await callAsync(Channels.BIBLIOGRAPHY_SET_STYLE, 'ieee');
    expect(h.setBibliographyStyleId).toHaveBeenCalledWith(ROOT, 'ieee');
  });

  it('BIBLIOGRAPHY_SET_STYLE refuses an unknown id instead of storing a dud', async () => {
    // Storing an id with no XML behind it would fail later, at export time,
    // far from the setting that caused it.
    await expect(callAsync(Channels.BIBLIOGRAPHY_SET_STYLE, 'chicago-note'))
      .rejects.toThrow('Unknown CSL style: chicago-note');
    expect(h.setBibliographyStyleId).not.toHaveBeenCalled();
  });

  it.each(['constructor', 'toString', '__proto__'])(
    'BIBLIOGRAPHY_SET_STYLE refuses the inherited key %s', async (key) => {
      // `hasOwnProperty.call` rather than `styleId in styles` — a plain `in`
      // would accept every Object.prototype member as a valid style.
      await expect(callAsync(Channels.BIBLIOGRAPHY_SET_STYLE, key))
        .rejects.toThrow(`Unknown CSL style: ${key}`);
      expect(h.setBibliographyStyleId).not.toHaveBeenCalled();
    });
});

describe('register-bibliography — user CSL assets', () => {
  it('CSL_LIST_USER_STYLES reports only what the settings row needs', async () => {
    // Not the XML: the renderer never renders it, and these files are large.
    h.loadUserStyles.mockResolvedValue([
      { id: 'house', label: 'House Style', filePath: '/vault/.minerva/csl-styles/house.csl', xml: STYLE_XML },
    ]);
    await expect(callAsync(Channels.CSL_LIST_USER_STYLES)).resolves.toEqual([
      { id: 'house', label: 'House Style', filePath: '/vault/.minerva/csl-styles/house.csl' },
    ]);
  });

  it('CSL_LIST_USER_LOCALES reports only what the settings row needs', async () => {
    h.loadUserLocales.mockResolvedValue([
      { id: 'en-GB', filePath: '/vault/.minerva/csl-locales/en-GB.xml', xml: LOCALE_XML },
    ]);
    await expect(callAsync(Channels.CSL_LIST_USER_LOCALES)).resolves.toEqual([
      { id: 'en-GB', filePath: '/vault/.minerva/csl-locales/en-GB.xml' },
    ]);
  });

  it('CSL_IMPORT_STYLE copies the file into the project and names it from its <title>', async () => {
    h.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/downloads/House Style.csl'] });
    h.readFile.mockResolvedValue(STYLE_XML);

    await expect(callAsync(Channels.CSL_IMPORT_STYLE)).resolves.toEqual({
      id: 'house-style',
      label: 'House Style',
      filePath: `${ROOT}/${USER_STYLES_DIR}/house-style.csl`,
    });

    // The import is a copy, not a reference: the picked file can be deleted
    // or live on a volume that isn't mounted next time.
    expect(h.mkdir).toHaveBeenCalledWith(`${ROOT}/${USER_STYLES_DIR}`, { recursive: true });
    expect(h.writeFile).toHaveBeenCalledWith(`${ROOT}/${USER_STYLES_DIR}/house-style.csl`, STYLE_XML, 'utf-8');
  });

  it('CSL_IMPORT_STYLE falls back to the derived id when the style has no title', async () => {
    h.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/downloads/untitled.csl'] });
    h.readFile.mockResolvedValue('<style xmlns="http://purl.org/net/xbiblio/csl"/>');
    await expect(callAsync(Channels.CSL_IMPORT_STYLE))
      .resolves.toEqual({ id: 'untitled', label: 'untitled', filePath: `${ROOT}/${USER_STYLES_DIR}/untitled.csl` });
  });

  it('CSL_IMPORT_STYLE rejects a file that is not CSL, whatever its extension says', async () => {
    // The picker filters on `.csl`/`.xml`; only the content proves it's a
    // style, and a non-style file would poison the picker with a broken entry.
    h.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/downloads/notes.xml'] });
    h.readFile.mockResolvedValue('<html><body>not csl</body></html>');

    await expect(callAsync(Channels.CSL_IMPORT_STYLE)).rejects.toThrow('not a valid CSL style');
    expect(h.writeFile).not.toHaveBeenCalled();
  });

  it('CSL_IMPORT_STYLE rejects a filename that derives no usable id', async () => {
    h.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/downloads/++.csl'] });
    h.readFile.mockResolvedValue(STYLE_XML);
    await expect(callAsync(Channels.CSL_IMPORT_STYLE)).rejects.toThrow('Could not derive a style id');
    expect(h.writeFile).not.toHaveBeenCalled();
  });

  it('CSL_IMPORT_LOCALE copies the locale in, preserving its case', async () => {
    // Locale ids are matched case-sensitively by citeproc ("en-GB", not
    // "en-gb"), so unlike style ids these are not lowercased.
    h.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/downloads/locales-en-GB.xml'] });
    h.readFile.mockResolvedValue(LOCALE_XML);

    await expect(callAsync(Channels.CSL_IMPORT_LOCALE)).resolves.toEqual({
      id: 'en-GB',
      filePath: `${ROOT}/${USER_LOCALES_DIR}/en-GB.xml`,
    });
    expect(h.writeFile).toHaveBeenCalledWith(`${ROOT}/${USER_LOCALES_DIR}/en-GB.xml`, LOCALE_XML, 'utf-8');
  });

  it('CSL_IMPORT_LOCALE rejects a file that is not a CSL locale', async () => {
    h.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/downloads/style.xml'] });
    h.readFile.mockResolvedValue(STYLE_XML); // a style, not a locale
    await expect(callAsync(Channels.CSL_IMPORT_LOCALE)).rejects.toThrow('not a valid CSL locale');
    expect(h.writeFile).not.toHaveBeenCalled();
  });

  it.each([
    [Channels.CSL_IMPORT_STYLE, 'cancelled', { canceled: true, filePaths: [] }],
    [Channels.CSL_IMPORT_STYLE, 'dismissed with no file', { canceled: false, filePaths: [] }],
    [Channels.CSL_IMPORT_LOCALE, 'cancelled', { canceled: true, filePaths: [] }],
    [Channels.CSL_IMPORT_LOCALE, 'dismissed with no file', { canceled: false, filePaths: [] }],
  ])('%s imports nothing when the picker is %s', async (channel, _label, dialogResult) => {
    h.showOpenDialog.mockResolvedValue(dialogResult);
    await expect(callAsync(channel)).resolves.toBeNull();
    expect(h.readFile).not.toHaveBeenCalled();
    expect(h.writeFile).not.toHaveBeenCalled();
  });

  it('CSL_REMOVE_STYLE deletes the imported file from the project', async () => {
    await callAsync(Channels.CSL_REMOVE_STYLE, 'house-style');
    expect(h.unlink).toHaveBeenCalledWith(`${ROOT}/${USER_STYLES_DIR}/house-style.csl`);
  });

  it('CSL_REMOVE_LOCALE deletes the imported locale from the project', async () => {
    await callAsync(Channels.CSL_REMOVE_LOCALE, 'en-GB');
    expect(h.unlink).toHaveBeenCalledWith(`${ROOT}/${USER_LOCALES_DIR}/en-GB.xml`);
  });

  it.each([
    ['../../../etc/passwd'],
    ['..'],
    ['sub/dir'],
    ['name with spaces'],
    [''],
  ])('CSL_REMOVE_STYLE refuses the id %j rather than joining it into a path', async (id) => {
    // The target path is built by interpolation, so this regex is the whole
    // traversal guard — no `assertSafePath` runs on this route.
    await expect(callAsync(Channels.CSL_REMOVE_STYLE, id)).rejects.toThrow('Invalid style id.');
    expect(h.unlink).not.toHaveBeenCalled();
  });

  it.each([
    ['../../../etc/passwd'],
    ['..'],
    ['sub/dir'],
    [''],
  ])('CSL_REMOVE_LOCALE refuses the id %j rather than joining it into a path', async (id) => {
    await expect(callAsync(Channels.CSL_REMOVE_LOCALE, id)).rejects.toThrow('Invalid locale id.');
    expect(h.unlink).not.toHaveBeenCalled();
  });

  it('removing a style that was already gone is not an error', async () => {
    // Two settings windows, one file: the second remove is a no-op the user
    // shouldn't see an error for.
    h.unlink.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    await expect(callAsync(Channels.CSL_REMOVE_STYLE, 'house-style')).resolves.toBeUndefined();
  });

  it('a remove that failed for a REAL reason is swallowed too — a known #1631 outlier', async () => {
    // Documented in CLAUDE.md's migration backlog ("CSL_REMOVE_STYLE /
    // CSL_REMOVE_LOCALE (unlink swallows non-ENOENT)"): the bare
    // `.catch(() => undefined)` also hides EACCES/EIO, so the settings row
    // disappears while the file stays on disk and reappears on reload. Pinned
    // as-is so the fix is a deliberate, visible change rather than a surprise.
    h.unlink.mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }));
    await expect(callAsync(Channels.CSL_REMOVE_STYLE, 'house-style')).resolves.toBeUndefined();
  });
});

describe('register-bibliography — CITATION_RENDER_INLINE', () => {
  it('renders the requested references for the open project', async () => {
    const refs = [{ key: 'smith2020', locator: '12' }];
    h.renderInlineCitations.mockResolvedValue({ markers: ['(Smith 2020, 12)'], bibliography: '…', missing: [], styleId: 'apa' });
    await expect(callAsync(Channels.CITATION_RENDER_INLINE, refs))
      .resolves.toEqual({ markers: ['(Smith 2020, 12)'], bibliography: '…', missing: [], styleId: 'apa' });
    expect(h.renderInlineCitations).toHaveBeenCalledWith(ROOT, refs);
  });

  it('treats a missing ref list as an empty one', async () => {
    // The preview calls this on every keystroke; an undefined batch is a
    // normal transient, not something to reject over.
    h.renderInlineCitations.mockResolvedValue({ markers: [], bibliography: null, missing: [], styleId: 'apa' });
    await callAsync(Channels.CITATION_RENDER_INLINE, undefined);
    expect(h.renderInlineCitations).toHaveBeenCalledWith(ROOT, []);
  });
});

describe('register-bibliography — BIBLIOGRAPHY_GENERATE', () => {
  it('writes the regenerated note through the history-aware pipeline', async () => {
    h.notebaseReadFile.mockResolvedValue('# Note\n\n[@smith2020]');
    h.generateBibliography.mockResolvedValue({
      changed: true, content: '# Note\n\n[@smith2020]\n\n## References\n…',
      entriesCount: 1, missingIds: [], styleId: 'apa',
    });

    await expect(callAsync(Channels.BIBLIOGRAPHY_GENERATE, 'notes/a.md'))
      .resolves.toEqual({ entriesCount: 1, missingIds: [], changed: true, styleId: 'apa' });

    expect(h.generateBibliography).toHaveBeenCalledWith(ROOT, '# Note\n\n[@smith2020]');
    // Named cause: a history timeline full of anonymous edits is unreadable.
    expect(h.runWithHistorySource).toHaveBeenCalledWith(
      { origin: 'edit', cause: 'Bibliography' },
      expect.any(Function),
    );
    // Through the pipeline, not a bare fs write — graph, search and any open
    // editor have to see the new text too.
    expect(h.writeAndReindex).toHaveBeenCalledWith(
      ROOT, 'notes/a.md', '# Note\n\n[@smith2020]\n\n## References\n…', { HOOKS: true },
    );
  });

  it('writes nothing when the bibliography was already up to date', async () => {
    // A no-op save would still stamp a history revision and re-index the note.
    h.notebaseReadFile.mockResolvedValue('# Note');
    h.generateBibliography.mockResolvedValue({ changed: false, content: '# Note', entriesCount: 0, missingIds: [], styleId: 'apa' });

    await expect(callAsync(Channels.BIBLIOGRAPHY_GENERATE, 'notes/a.md'))
      .resolves.toEqual({ entriesCount: 0, missingIds: [], changed: false, styleId: 'apa' });
    expect(h.writeAndReindex).not.toHaveBeenCalled();
    expect(h.runWithHistorySource).not.toHaveBeenCalled();
  });

  it('reports citation keys with no matching source instead of failing', async () => {
    // Missing keys are a normal state of a draft, so the note is still
    // rewritten and the gaps are reported for the UI to list.
    h.notebaseReadFile.mockResolvedValue('# Note\n\n[@ghost]');
    h.generateBibliography.mockResolvedValue({
      changed: true, content: '# Note\n\n[@ghost]\n\n## References\n', entriesCount: 0,
      missingIds: ['ghost'], styleId: 'ieee',
    });

    await expect(callAsync(Channels.BIBLIOGRAPHY_GENERATE, 'notes/a.md'))
      .resolves.toEqual({ entriesCount: 0, missingIds: ['ghost'], changed: true, styleId: 'ieee' });
    expect(h.writeAndReindex).toHaveBeenCalled();
  });

  it('lets a read failure reject rather than generating over an empty note', async () => {
    h.notebaseReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    await expect(callAsync(Channels.BIBLIOGRAPHY_GENERATE, 'notes/gone.md')).rejects.toThrow('ENOENT');
    expect(h.generateBibliography).not.toHaveBeenCalled();
    expect(h.writeAndReindex).not.toHaveBeenCalled();
  });
});
