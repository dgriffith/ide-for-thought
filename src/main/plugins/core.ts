/**
 * Core plugins (#2820, epic #2819): plugins that ship inside the signed app
 * and can be switched off on this machine, like Obsidian's core plugins.
 *
 * A core plugin is held to the same `plugin.json` format as any other, and
 * checked by the same validator. Minerva's signature vouches for it, so it
 * needs no install approval, and it can't be removed, only turned off. Its
 * state is a record in `plugins.json` beside the installed plugins' records
 * (`source: { kind: 'core' }`); a core plugin with no record has its
 * default state.
 *
 * Its wiring (IPC handlers, registry entries, processes) is the app's own
 * code, activated by the composition root (`core-plugins.ts`) only while the
 * plugin is on. Off means not wired up, not hidden. That's why this module
 * says what core plugins exist and whether each is on, and nothing about what
 * they do: `plugins/` importing the subsystems it switches would make a
 * package cycle of every one of them.
 *
 * A core plugin's id is reserved: a folder in `~/.minerva/plugins/` claiming
 * one is refused, so a third-party plugin can't stand in for a built-in one.
 */
import type { PluginManifest } from '../../shared/plugins/format';
import { validatePluginManifest } from './manifest';
import { loadPluginRecordsSync, updatePluginRecords, updatePluginRecordsSync, type PluginRecords } from './state';

export interface CorePluginDefinition {
  /** Its `plugin.json`, as written. */
  manifest: Record<string, unknown>;
  /** On or off on a machine that has never switched it. */
  defaultEnabled: boolean;
  /**
   * A worked example of one plugin seam, shipped to show what a plugin can
   * do rather than as a part of Minerva. Settings lists these apart.
   */
  sample?: boolean;
}

export interface CorePlugin {
  manifest: PluginManifest;
  defaultEnabled: boolean;
  sample: boolean;
}

/** The core plugins, in the order Settings lists them. */
const CORE_PLUGIN_DEFINITIONS: readonly CorePluginDefinition[] = [
  {
    // Python cells (#2822): the one compute language that runs arbitrary code,
    // so it's off on a new install. SQL and SPARQL cells are read-only and
    // stay part of Minerva itself.
    manifest: {
      id: 'python',
      name: 'Python',
      version: '1.0.0',
      minerva: '>=4.0.0',
      description: [
        "Run Python code cells in notes, in an interpreter you choose: pandas, numpy, matplotlib and anything else you install.",
        "",
        "Write a ```` ```python ```` fence in a note and run it with its ▶ button, or rerun every cell with **Recompute all**. The result (a table, text, an image or a chart) is written into the note just below the cell. Pick the interpreter in **Settings → Compute**. With this plugin off, Python fences show as plain code and nothing runs.",
        "",
        "## Security",
        "",
        "Python runs **on your machine, with your permissions**: it can read and write your files, reach the network and use any package you've installed. That's why it's off on a new install.",
        "",
        "- Before any cell runs, Minerva asks in its own dialog, showing the code. You can trust every cell in a thoughtbase at once, and revoke that later.",
        "- A cell the assistant proposes always shows its code first, even in a trusted thoughtbase.",
        "- A shared thoughtbase can contain Python: only run code you've read or trust.",
        "- Choosing an interpreter is confirmed the same way, showing the program that will run.",
      ].join('\n'),
      contributes: {},
      code: { capabilities: ['process'] },
    },
    defaultEnabled: false,
  },
  {
    // Local MCP servers (#2891): stdio servers are programs Minerva runs, so
    // adding, changing and running one is this plugin's, off on a new
    // install. Remote (HTTP) servers run nothing here and stay Minerva's own.
    manifest: {
      id: 'local-mcp-servers',
      name: 'Local MCP servers',
      version: '1.0.0',
      minerva: '>=4.0.0',
      description: [
        "Run MCP servers as programs on your machine (stdio): ones you add in Settings → MCP Servers, and the servers plugins ship. Remote (HTTP) servers work without it.",
        "",
        "An MCP server gives the assistant extra tools (a database, a code host, a search service) to call in a conversation. Local servers are programs Minerva starts and talks to. Remote ones are web services it connects to, and don't need this plugin.",
        "",
        "## Security",
        "",
        "A local MCP server is **a program running as you**, with access to whatever you can reach. That's why this is off on a new install.",
        "",
        "- Adding a server, or changing its command, arguments or environment, is confirmed in Minerva's own dialog, showing exactly what will run.",
        "- In a conversation, a tool that isn't marked read-only waits for you to allow it, showing its arguments. \"Don't ask again\" is per server and tool, and is forgotten if the server's command changes.",
        "- A thoughtbase can't add a server or pre-approve a tool; both live on your machine.",
        "- A server that labels a writing tool as read-only would run it without asking: only add servers you trust.",
      ].join('\n'),
      contributes: {},
      code: { capabilities: ['process'] },
    },
    defaultEnabled: false,
  },
  {
    // The Kanban layout (#2828): the first view drawn by plugin code, in a
    // plugin frame (`plugins/kanban/`), on the plugin API like any plugin.
    // On by default: it was part of Minerva before, and it is safe — it reads
    // the notes a view shows and moves them between columns, nothing else.
    manifest: {
      id: 'kanban',
      name: 'Kanban',
      version: '1.0.0',
      minerva: '>=4.0.0',
      description: [
        "Show a type view as a board: a column per option of a choice property, cards you drag between them.",
        "",
        "Pick **Kanban** in a type view's layouts. Choose which property to group by, drag cards between columns to change it, and drag within a column to set your own order. Columns can be reordered and empty ones hidden. Right-click a card for its tags and properties, or **Move to ▸**. ⌘Z undoes the last move.",
        "",
        "## Security",
        "",
        "The board is drawn in a sandboxed frame. It can't reach the network or your files, and sees only the notes in the view.",
        "",
        "- Moving a card is the only write to a note. Minerva makes it (it sets the one grouping property), records it in Local History as *Moved by Kanban*, and can undo it.",
        "- Column and card order belong to the view, not the notes: changing them writes nothing to a note.",
        "- A board embedded in a note is read-only.",
      ].join('\n'),
      contributes: {},
      code: { capabilities: ['notes:read', 'notes:write-properties', 'ui'], api: '^1.5.0' },
    },
    defaultEnabled: true,
  },
  {
    // The Timeline layout (#2829), drawn the same way (`plugins/timeline/`).
    // It reads the notes a view shows and writes nothing to them: zooming
    // and panning change only the view's own range, through `view.setState`.
    manifest: {
      id: 'timeline',
      name: 'Timeline',
      version: '1.0.0',
      minerva: '>=4.0.0',
      description: [
        "Show a type view on a time axis: each dated note a point or a bar, zoomed and panned with the pointer or the keyboard.",
        "",
        "Pick **Timeline** in a type view's layouts, for any type with a date property. Notes with an end date draw as bars; dates known only to the month or year draw as hatched spans. **Fit** shows everything, and the range you zoom to is kept with the view. Hover or focus an event for its preview, and right-click it for its tags and properties.",
        "",
        "## Security",
        "",
        "The timeline is drawn in a sandboxed frame. It can't reach the network or your files, and sees only the notes in the view.",
        "",
        "- It writes nothing to your notes. The only thing it changes is the view's own range.",
        "- Tags and properties changed from its menu are Minerva's edits, made the same way as from any view.",
      ].join('\n'),
      contributes: {},
      code: { capabilities: ['notes:read', 'ui'], api: '^1.6.0' },
    },
    defaultEnabled: true,
  },
  {
    // The Calendar layout (#2829), drawn the same way (`plugins/calendar/`).
    // It reads the notes a view shows, and moves one to another day only by
    // asking Minerva (`view.reschedule`), which writes its dates with undo.
    manifest: {
      id: 'calendar',
      name: 'Calendar',
      version: '1.0.0',
      minerva: '>=4.0.0',
      description: [
        "Show a type view as a month grid: each dated note on its day, dragged to another day to reschedule it.",
        "",
        "Pick **Calendar** in a type view's layouts, for any type with a date property. Multi-day notes run as bars; notes dated only to a month or year sit in bands above the grid. Drag an event to another day, or right-click it and choose **Move to date…** to pick a day with the keyboard or type one. ⌘Z undoes the last move.",
        "",
        "## Security",
        "",
        "The calendar is drawn in a sandboxed frame. It can't reach the network or your files, and sees only the notes in the view.",
        "",
        "- Rescheduling is its only write to a note. Minerva moves the note's date (and end) by whole days in one save, keeps the way they were written, records it in Local History as *Moved by Calendar*, and can undo it.",
        "- An event dated only to a month or year is never given a day it doesn't have.",
        "- A calendar embedded in a note is read-only.",
      ].join('\n'),
      contributes: {},
      code: { capabilities: ['notes:read', 'notes:write-properties', 'ui'], api: '^1.7.0' },
    },
    defaultEnabled: true,
  },
  {
    // The Reading Queue (#2640): the worked example of a global view, a
    // panel fed by a query it declares (`plugins/reading-queue/public/queue.rq`).
    // It lists and opens the books and articles that query names, and marks
    // one read; it reads no note's text. Off by default: it adds a panel.
    // And of a live block (#2641): a ```reading-queue fence draws the same
    // queue in a note, in the preview and every export.
    manifest: {
      id: 'reading-queue',
      name: 'Reading Queue',
      version: '1.0.0',
      minerva: '>=4.0.0',
      description: [
        "A sidebar panel of the books and articles you're reading and those still to read, each marked read with one click — and a reading-queue block to put the same list in a note.",
        "",
        "Books and articles you're reading come first, then those still to read. Click one to open it, or its ✓ (**Mark read**) to take it off the list. To put the queue in a note, add a ```` ```reading-queue ```` block, with `limit: 5` inside it to show only the first few.",
        "",
        "This is a sample plugin: its source is in Minerva's repository, as a worked example of a sidebar panel and a live block.",
        "",
        "## Security",
        "",
        "It runs in a sandboxed frame, with no network and no file access.",
        "",
        "- Its list comes from a read-only query that Minerva runs, not the plugin. It can see only the notes that query names.",
        "- Its one write is **Mark read**, which sets that note's `status` (books) or `read` (articles) to `read`, through Minerva, recorded in Local History.",
      ].join('\n'),
      contributes: {},
      code: {
        capabilities: ['graph:query', 'notes:write-properties', 'ui'],
        api: '^1.9.0',
        views: [{ id: 'queue', title: 'Reading Queue', place: 'left-sidebar', entry: 'index.html', query: 'queue.rq', icon: 'bookmark' }],
        blocks: [{ id: 'queue', title: 'Reading queue', fence: 'reading-queue', entry: 'index.html', query: 'queue.rq' }],
      },
    },
    defaultEnabled: false,
    sample: true,
  },
  {
    // List Tools (#2643): the worked example of a command whose handler is
    // the plugin's own code. "Sort List in Selection" runs `sortSelection` in
    // its worker host (`plugins/list-tools/src/logic.ts`), which is handed the
    // selected text and returns it sorted; the editor makes the change. It
    // reads and writes no note. It's in the Edit menu, on ⌘⌥⇧S (#2879). Off
    // by default: it adds a command.
    manifest: {
      id: 'list-tools',
      name: 'List Tools',
      version: '1.0.0',
      minerva: '>=4.0.0',
      description: [
        "Sort the Markdown list in your selection, from the command palette, the Edit menu, the editor's right-click menu or ⌘⌥⇧S. Nested items move with their parent.",
        "",
        "Select a list and run **Sort List in Selection**. Its outermost items sort by their text, ignoring case, checkboxes and list markers, with numbers in numeric order (\"item 2\" before \"item 10\"). Each item keeps its nested items and continuation lines, and an ordered list is renumbered.",
        "",
        "This is a sample plugin: its source is in Minerva's repository, as a worked example of a command run by plugin code.",
        "",
        "## Security",
        "",
        "Its code runs in a sandboxed worker, with no network and no file access.",
        "",
        "- It sees only the text you selected, and returns the sorted text. Minerva puts it back only if that text is still selected and unchanged, so a stale result can't overwrite an edit.",
        "- The change is an ordinary edit in your editor: ⌘Z undoes it.",
      ].join('\n'),
      contributes: {},
      code: {
        capabilities: ['notes:read'],
        api: '^1.10.0',
        worker: 'logic.js',
        commands: [{ id: 'sort-selection', title: 'Sort List in Selection', when: 'selection', editorMenu: true, menu: 'edit', key: 'CmdOrCtrl+Alt+Shift+S', run: { handler: 'sortSelection' } }],
      },
    },
    defaultEnabled: false,
    sample: true,
  },
  {
    // Transcripts (#2647): the worked example of an ingestor whose parser is
    // the plugin's own code. Ingest File offers .srt and .vtt; the file's
    // bytes go to `parseTranscript` in its worker host
    // (`plugins/transcripts/src/logic.ts`), which returns the transcript as a
    // source draft, and Minerva writes the Source. No note is in its scope.
    // Off by default: it adds a file type.
    manifest: {
      id: 'transcripts',
      name: 'Transcripts',
      version: '1.0.0',
      minerva: '>=4.0.0',
      description: [
        "Ingest subtitle and caption files (.srt, .vtt) as sources: the captions joined into timestamped paragraphs, with speakers named.",
        "",
        "Ingest a `.srt` or `.vtt` file with **Research → Ingest File as Source…**. Caption cues are joined into paragraphs, each opening with the time it starts at, so a passage can be cited by when it was said. A new paragraph starts when the speaker changes (a WebVTT `<v Name>` voice, or a `NAME:` in capitals), after a pause, or once a paragraph runs long. Lines that rolling captions repeat are dropped.",
        "",
        "This is a sample plugin: its source is in Minerva's repository, as a worked example of an ingestor.",
        "",
        "## Security",
        "",
        "Its code runs in a sandboxed worker, with no network and no file access.",
        "",
        "- It's handed only the bytes of the file you're ingesting, and returns a draft.",
        "- Minerva checks the draft field by field, escapes it, and writes the source itself, marked as ingested by this plugin.",
      ].join('\n'),
      contributes: {},
      code: {
        capabilities: ['notes:read'],
        api: '^1.10.0',
        worker: 'logic.js',
        ingestors: [{ id: 'transcript', label: 'Transcript', accepts: { extensions: ['.srt', '.vtt'] }, parse: { handler: 'parseTranscript' } }],
      },
    },
    defaultEnabled: false,
    sample: true,
  },
  {
    // EPUB (#2648): the worked example of an exporter whose writer is the
    // plugin's own code. Export as EPUB hands the notes Minerva rendered to
    // `writeEpub` in its worker host (`plugins/epub/src/logic.ts`), which
    // returns the book as bytes; Minerva writes it. No note is in its scope.
    // Off by default: it adds an export format.
    manifest: {
      id: 'epub',
      name: 'EPUB',
      version: '1.0.0',
      minerva: '>=4.0.0',
      description: [
        "Export notes as an EPUB e-book: one chapter per note, with a table of contents, for any e-reader.",
        "",
        "Choose **EPUB** when you export a note, a note and the notes it links to, a folder, or the whole thoughtbase. Each note becomes a chapter, rendered as the preview shows it, under a table of contents. The book takes the note's, the folder's or the thoughtbase's name.",
        "",
        "This is a sample plugin: its source is in Minerva's repository, as a worked example of an exporter.",
        "",
        "## Security",
        "",
        "Its code runs in a sandboxed worker, with no network and no file access.",
        "",
        "- It's handed the notes you chose to export, already rendered, and returns the book's files.",
        "- Minerva checks every path it returns and writes the book only where you chose to save it.",
      ].join('\n'),
      contributes: {},
      code: {
        capabilities: ['notes:read'],
        api: '^1.10.0',
        worker: 'logic.js',
        exporters: [{ id: 'epub', label: 'EPUB', input: 'html', scopes: ['single-note', 'folder', 'project', 'tree'], write: { handler: 'writeEpub' } }],
      },
    },
    defaultEnabled: false,
    sample: true,
  },
  {
    // Outline Checks (#2831): the worked example of an inspection written as
    // code, one a SHACL shape can't say because it reads each note's body.
    // Every sweep runs its query (`notes.rq`, the Markdown notes) and hands
    // the notes to `skippedHeadings` in its worker host
    // (`plugins/outline-checks/src/logic.ts`), which reads them and returns
    // findings. Off by default: it adds a check.
    manifest: {
      id: 'outline-checks',
      name: 'Outline Checks',
      version: '1.0.0',
      minerva: '>=4.0.0',
      description: [
        "An inspection for notes whose headings skip a level, like an H1 straight to an H3, which leaves a gap in the outline.",
        "",
        "The check runs with Minerva's other inspections, after each save, and its findings appear in the Inspections panel: each names the note and the heading that skips. Turn the check off in **Settings → Inspections** like any other.",
        "",
        "This is a sample plugin: its source is in Minerva's repository, as a worked example of an inspection written as code.",
        "",
        "## Security",
        "",
        "Its code runs in a sandboxed worker, with no network and no file access.",
        "",
        "- It reads only the notes Minerva hands it for the check, and returns findings.",
        "- It writes nothing: a finding is a suggestion you act on yourself.",
      ].join('\n'),
      contributes: {},
      code: {
        capabilities: ['notes:read', 'graph:query'],
        api: '^1.10.0',
        worker: 'logic.js',
        inspections: [{
          id: 'skipped-heading', label: 'Skipped heading levels', severity: 'info',
          description: 'Headings that jump a level, like an H1 straight to an H3, leaving a gap in the outline.',
          query: 'notes.rq', run: { handler: 'skippedHeadings' },
        }],
      },
    },
    defaultEnabled: false,
    sample: true,
  },
  {
    // Steel (sample): the worked example of a theme, and the one sample with
    // no code. Its `themes/steel.json` is the file an installed plugin ships,
    // bundled into the app (`plugins/themes.ts` reads it from
    // `plugins/steel-theme/`) and offered in the theme pickers while the
    // plugin is on. Off by default: it adds a theme.
    manifest: {
      id: 'steel-theme',
      name: 'Steel',
      version: '1.0.0',
      minerva: '>=4.0.0',
      description: [
        "A light colour theme: white pages, light grey chrome and steel-blue accents. Turn it on, then pick **Steel** in Settings → Appearance.",
        "",
        "It changes only colours: layout, fonts and everything else stay as they are.",
        "",
        "This is a sample plugin: its theme file is in Minerva's repository, as a worked example of a theme.",
        "",
        "## Security",
        "",
        "It has no code at all: it's one file of colour values.",
        "",
        "- A theme can set only Minerva's colour tokens, to colours.",
        "- It can't load anything from the network or add styles of its own.",
      ].join('\n'),
      contributes: { themes: ['themes/steel.json'] },
    },
    defaultEnabled: false,
    sample: true,
  },
];

let definitions: readonly CorePluginDefinition[] = CORE_PLUGIN_DEFINITIONS;
let validated: CorePlugin[] | null = null;

/**
 * The core plugins, checked. A core manifest that doesn't validate is a bug
 * in this build, not a user's problem to read about, so it throws.
 */
export function corePlugins(): readonly CorePlugin[] {
  validated ??= definitions.map((def) => {
    const id = typeof def.manifest.id === 'string' ? def.manifest.id : '';
    const checked = validatePluginManifest(def.manifest, { folder: id, appVersion: '0.0.0', core: true });
    if (!checked.ok) throw new Error(`Core plugin "${id}" has an invalid manifest: ${checked.problems.join(' ')}`);
    return { manifest: checked.manifest, defaultEnabled: def.defaultEnabled, sample: def.sample ?? false };
  });
  return validated;
}

/** The core plugin with this id, if there is one. */
export function corePlugin(id: string): CorePlugin | undefined {
  return corePlugins().find((p) => p.manifest.id === id);
}

/** Whether `id` belongs to a core plugin, and so can't be installed. */
export function isCorePluginId(id: string): boolean {
  return corePlugin(id) !== undefined;
}

/** Whether a core plugin is on, given the records: its own, or its default. */
export function corePluginEnabled(records: PluginRecords, plugin: CorePlugin): boolean {
  const record = Object.hasOwn(records, plugin.manifest.id) ? records[plugin.manifest.id] : undefined;
  return record?.source.kind === 'core' ? record.enabled : plugin.defaultEnabled;
}

/** Every core plugin's state on this machine, read synchronously (startup). */
export function readCorePluginStates(pluginsDir: string): Map<string, boolean> {
  const records = loadPluginRecordsSync(pluginsDir);
  return new Map(corePlugins().map((p) => [p.manifest.id, corePluginEnabled(records, p)]));
}

/**
 * Record a core plugin as on or off, but only on a machine that has never
 * switched it: a one-time decision made at startup, synchronously (#2822).
 * Returns whether it wrote. A record already there, however it got there,
 * stands.
 */
export function adoptCorePluginState(pluginsDir: string, id: string, enabled: boolean): boolean {
  if (!isCorePluginId(id)) throw new Error(`No core plugin "${id}".`);
  let wrote = false;
  updatePluginRecordsSync(pluginsDir, (records) => {
    if (records[id]?.source.kind === 'core') return;
    records[id] = { enabled, source: { kind: 'core' } };
    wrote = true;
  });
  return wrote;
}

/** Whether this machine has ever switched a core plugin (has its record). */
export function hasCorePluginRecord(pluginsDir: string, id: string): boolean {
  const records = loadPluginRecordsSync(pluginsDir);
  return Object.hasOwn(records, id) && records[id]!.source.kind === 'core';
}

/** Switch a core plugin on or off on this machine. */
export async function setCorePluginEnabled(pluginsDir: string, id: string, enabled: boolean): Promise<void> {
  if (!isCorePluginId(id)) throw new Error(`No core plugin "${id}".`);
  await updatePluginRecords(pluginsDir, (records) => {
    records[id] = { enabled, source: { kind: 'core' } };
  });
}

/** Replace the core plugins; `null` puts the real ones back. Tests only. */
export function _setCorePluginsForTests(defs: readonly CorePluginDefinition[] | null): void {
  definitions = defs ?? CORE_PLUGIN_DEFINITIONS;
  validated = null;
}
