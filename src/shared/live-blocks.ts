/**
 * Live blocks (#2508, #2624): the things a note's preview renders live, and
 * the protocol between the export pipeline (main) and the window that renders
 * them with the preview's own components (#2510). Pure types + constants,
 * shared by both processes.
 *
 * `LIVE_BLOCKS` is the ONE list of kinds. Each side keeps its half in a map
 * keyed by kind, so a kind registered here without a half there doesn't
 * compile:
 *
 * - the preview: fence renderers (`markdown/fence-plugin.ts`), directive
 *   rules (`preview/markdown-config.ts`), the card pass (`Preview.svelte`);
 * - an export: the window's renderers (`app/export-live-blocks.ts`) for a
 *   `window` kind, a main-process transform (`publish/live-blocks.ts`'s
 *   `MAIN_TRANSFORMS`) for a `main` kind.
 *
 * Built-ins register here. Plugins' blocks (#2641) are the one `plugin`
 * kind: which fences and directives it covers is per machine (the plugins
 * that are on), so each side resolves a name to a plugin's block at render
 * time, the preview from its plugin list, an export from main's.
 */

/** How a block is written in a note. */
export type LiveBlockSyntax =
  /** A fenced code block in one of these languages (lowercased). */
  | { fence: readonly string[] }
  /** A `:::` directive: an opening line matching `opener` (after up to three
   *  spaces of indent), closed by the first line that is `:::`. */
  | { directive: RegExp }
  /** A top-level paragraph that is one plain `[[link]]` (or `[[quote::id]]`)
   *  and nothing else, which the preview may draw as a card (#1071). */
  | { cardLink: true }
  /** A fence or directive a plugin draws (#2641): whichever names the
   *  plugins that are on declare (`PluginBlock`). */
  | { plugin: true };

export interface LiveBlockDef {
  kind: string;
  syntax: LiveBlockSyntax;
  /** How an export answers it: rendered by the window with the preview's
   *  own components (`window`), or transformed in main (`main`). */
  export: 'window' | 'main';
}

export const LIVE_BLOCKS = [
  { kind: 'object-view', syntax: { fence: ['object-view'] }, export: 'window' },
  { kind: 'mermaid', syntax: { fence: ['mermaid'] }, export: 'window' },
  { kind: 'output', syntax: { fence: ['output'] }, export: 'window' },
  { kind: 'query', syntax: { directive: /^:::query-(\w+)\s*$/ }, export: 'window' },
  { kind: 'argument', syntax: { directive: /^:::argument\s*$/ }, export: 'window' },
  { kind: 'card', syntax: { cardLink: true }, export: 'window' },
  // A chart, drawn to SVG in main (#831).
  { kind: 'vega', syntax: { fence: ['vega', 'vega-lite'] }, export: 'main' },
  // A linked thumbnail (#904).
  { kind: 'youtube', syntax: { fence: ['youtube'] }, export: 'main' },
  // A plugin's block (#2641), drawn in its frame; an export asks the window,
  // where the frame draws it static.
  { kind: 'plugin', syntax: { plugin: true }, export: 'window' },
] as const satisfies readonly LiveBlockDef[];

type Def = (typeof LIVE_BLOCKS)[number];
/** Every live-block kind. */
export type LiveBlockKind = Def['kind'];
/** Kinds an export asks a window to render. */
export type WindowBlockKind = Extract<Def, { export: 'window' }>['kind'];
/** Kinds an export transforms in main. */
export type MainBlockKind = Extract<Def, { export: 'main' }>['kind'];
/** Kinds written as a fence / a directive / a lone link. */
export type FenceBlockKind = Extract<Def, { syntax: { fence: readonly string[] } }>['kind'];
export type DirectiveBlockKind = Extract<Def, { syntax: { directive: RegExp } }>['kind'];
export type CardBlockKind = Extract<Def, { syntax: { cardLink: true } }>['kind'];

/** Fence language → its kind, for every fenced live block. */
export const LIVE_FENCE_LANGS: ReadonlyMap<string, FenceBlockKind> = new Map(
  LIVE_BLOCKS.flatMap((d) => ('fence' in d.syntax ? d.syntax.fence.map((lang) => [lang, d.kind as FenceBlockKind] as const) : [])),
);

/** The directive kinds with their opening-line patterns. */
export const LIVE_DIRECTIVE_OPENERS: ReadonlyArray<readonly [DirectiveBlockKind, RegExp]> = LIVE_BLOCKS.flatMap(
  (d) => ('directive' in d.syntax ? [[d.kind as DirectiveBlockKind, d.syntax.directive] as const] : []),
);

export interface LiveBlockRequest {
  /** Unique within one request batch. */
  id: string;
  kind: WindowBlockKind;
  /** The block's own text — the fence body, exactly as the preview reads it. */
  source: string;
  /** The note the block sits in (thoughtbase-relative). */
  notePath: string;
  /** The export is paged (PDF, #2709): the printable width is a hard limit,
   *  so a block wider than `EXPORT_BLOCK_WIDTH_PX` is drawn at that width. */
  paged?: boolean;
  /** A `plugin` block's (#2641): which plugin draws it, and which of its blocks. */
  plugin?: { pluginId: string; blockId: string };
}

/** A plugin block's fence or directive, and who draws it (#2641) — what both
 *  the preview and an export resolve a name against. */
export interface PluginBlockSyntax {
  pluginId: string;
  blockId: string;
  title: string;
  /** The fence language it draws, or the directive name. */
  fence?: string;
  directive?: string;
}

/** A directive's opening line, `:::<name>` (up to three spaces of indent are
 *  the caller's). `name` is validated as lowercase words and dashes, so it
 *  needs no escaping. */
export function pluginDirectiveOpener(name: string): RegExp {
  return new RegExp(`^:::${name}\\s*$`);
}

/** A rendered block is self-contained static HTML (its own scoped <style>);
 *  a failure carries a message the export shows in its place. */
export type LiveBlockResult =
  | { id: string; ok: true; html: string }
  | { id: string; ok: false; error: string };

/** Class on every rendered block's wrapper; the block's CSS is scoped under it. */
export const LIVE_BLOCK_CLASS = 'minerva-live-block';

/** Class of the frame around a block whose spec sets a `width` (#2709). */
export const LIVE_FRAME_CLASS = 'minerva-live-frame';

/** Attribute a rendered block puts on each element that should link to a note
 *  (value: the note's thoughtbase-relative path). The export resolves it
 *  through its link policy — an `href`, or no link at all. */
export const NOTE_LINK_ATTR = 'data-note-link';

/** Marks an element a static copy must drop entirely — a control that only
 *  means something with its handler (a Kanban column's `⋯` menu, #2604). The
 *  snapshot removes it, so a control mounted by mistake can't reach a page. */
export const EXPORT_OMIT_ATTR = 'data-export-omit';
