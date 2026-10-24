/**
 * Plugins' live blocks in the preview (#2641): a fence or a `:::` directive
 * whose name a plugin that's on draws (`PluginBlockSyntax`), rendered as a
 * placeholder the post-render pass mounts the plugin's frame into
 * (`markdown/plugin-block-renderer.ts`).
 *
 * The name is resolved when the note renders, through `deps.pluginBlock`,
 * because which plugins are on is per machine and can change while a note is
 * open; `Preview` re-renders when it does. A built-in fence or directive is
 * never a plugin's: the manifest check refuses those names, and the
 * built-ins' rules run first.
 */
import type { MarkdownIt, StateBlock, Token } from 'markdown-it';
import type { PluginBlockSyntax } from '../../../shared/live-blocks';
import { escapeAttr } from './text';
import type { PreviewMarkdownDeps } from './markdown-deps';

/** Class of a plugin block's placeholder; `data-plugin-block-pending` until the hydrator has mounted it. */
export const PLUGIN_BLOCK_CLASS = 'plugin-block';

/** The placeholder for one plugin block: who draws it, the note it's in, and its text. */
export function pluginBlockPlaceholderHtml(block: PluginBlockSyntax, source: string, notePath: string | null): string {
  const text = source.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div class="${PLUGIN_BLOCK_CLASS}" data-plugin-block-pending="1" data-plugin-id="${escapeAttr(block.pluginId)}"`
    + ` data-block-id="${escapeAttr(block.blockId)}" data-block-title="${escapeAttr(block.title)}"`
    + ` data-note-path="${escapeAttr(notePath ?? '')}">${text}</div>\n`;
}

/** A `:::name` opening line: the name a plugin's directive may have. */
const OPENER = /^:::([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\s*$/;

/**
 * The rule for plugins' directives, after every built-in one (each is
 * installed `before('fence')`, so this, installed last, runs after them): an
 * opening line naming a plugin's directive, a body up to the first `:::`
 * line, and an unclosed one isn't a directive — the built-ins' shape.
 */
export function installPluginDirectives(md: MarkdownIt, deps: PreviewMarkdownDeps): void {
  md.block.ruler.before('fence', 'plugin_directive', (state: StateBlock, startLine: number, endLine: number, silent: boolean) => {
    if (!deps.pluginBlock) return false;
    const startPos = state.bMarks[startLine]! + state.tShift[startLine]!;
    const opened = state.src.slice(startPos, state.eMarks[startLine]).match(OPENER);
    if (!opened) return false;
    const block = deps.pluginBlock('directive', opened[1]!);
    if (!block) return false;
    if (silent) return true;
    let nextLine = startLine + 1;
    let found = false;
    while (nextLine < endLine) {
      if (state.src.slice(state.bMarks[nextLine]! + state.tShift[nextLine]!, state.eMarks[nextLine]).trim() === ':::') {
        found = true;
        break;
      }
      nextLine++;
    }
    if (!found) return false;
    const token = state.push('plugin_directive', 'div', 0);
    // The body, as an export sends it: the lines between the opener and `:::`.
    token.content = state.src.slice(state.bMarks[startLine + 1], state.bMarks[nextLine]).replace(/\n$/, '');
    token.meta = { block };
    token.map = [startLine, nextLine + 1];
    state.line = nextLine + 1;
    return true;
  });
  md.renderer.rules['plugin_directive'] = (tokens: Token[], idx: number) => {
    const tok = tokens[idx]!;
    return pluginBlockPlaceholderHtml((tok.meta as { block: PluginBlockSyntax }).block, tok.content, deps.getRenderPathOverride() ?? deps.getNotePath());
  };
}
