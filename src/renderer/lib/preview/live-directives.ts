/**
 * The preview half of each `:::` directive live block (#2624): `:::query-*`
 * (#2512) and `:::argument` (#907). Keyed by kind, so a directive kind
 * registered in `shared/live-blocks.ts` without a preview here doesn't
 * compile; its opening line is the registry's, the same one the export
 * extracts by.
 *
 * Every directive shares the scaffold — an exact opening line, a body up to
 * the first line that is `:::`, an unclosed one isn't a directive — and
 * differs in how it reads that body and what it renders.
 */
import type { MarkdownIt, StateBlock, Token } from 'markdown-it';
import { LIVE_DIRECTIVE_OPENERS, type DirectiveBlockKind } from '../../../shared/live-blocks';
import { escapeAttr } from './text';
import { splitQueryDirective, queryBlockPlaceholderHtml } from './query-directive';

interface DirectivePreview {
  /** Fill the token from the opening line's match and the body. */
  fill: (token: Token, opened: RegExpMatchArray, body: string) => void;
  /** The token's HTML: a placeholder the post-render pass hydrates. */
  render: (token: Token) => string;
}

export const DIRECTIVE_PREVIEWS: Record<DirectiveBlockKind, DirectivePreview> = {
  // :::query-list … ::: — config above a `---`, query below, shared with the
  // export renderer (#2512).
  query: {
    fill: (token, opened, body) => {
      const { query, config } = splitQueryDirective(body);
      token.content = query;
      token.meta = { type: opened[1], config };
    },
    render: (token) => {
      const { type, config } = token.meta as { type: string; config: Record<string, unknown> };
      return queryBlockPlaceholderHtml(type, token.content, config);
    },
  },
  // :::argument … ::: (#907). The same config/body split (key: value lines
  // above an optional `---`, the focus wiki-link below), but its own token:
  // the data (a graph neighborhood) doesn't fit the `query-*` family, and the
  // hydrator mounts a real component (see argument-map-renderer.ts).
  argument: {
    fill: (token, _opened, body) => {
      const sepIdx = body.indexOf('\n---\n');
      const config: Record<string, string> = {};
      let focusBody: string;
      if (sepIdx >= 0) {
        const configBlock = body.slice(0, sepIdx).trim();
        focusBody = body.slice(sepIdx + 5).trim();
        for (const line of configBlock.split('\n')) {
          const colonIdx = line.indexOf(':');
          if (colonIdx > 0) {
            const key = line.slice(0, colonIdx).trim();
            const value = line.slice(colonIdx + 1).trim();
            if (key && value) config[key] = value;
          }
        }
      } else {
        focusBody = body;
      }
      token.content = focusBody;
      token.meta = { config };
    },
    render: (token) => {
      const { config } = token.meta as { config: Record<string, unknown> };
      const configJson = Object.keys(config).length > 0 ? escapeAttr(JSON.stringify(config)) : '';
      return `<div class="argument-map-block" data-focus="${escapeAttr(token.content)}"${configJson ? ` data-config="${configJson}"` : ''}></div>`;
    },
  },
};

/** Install every directive live block: a block rule and a renderer apiece,
 *  named `<kind>_directive`. */
export function installLiveDirectives(md: MarkdownIt): void {
  for (const [kind, opener] of LIVE_DIRECTIVE_OPENERS) {
    const name = `${kind}_directive`;
    const preview = DIRECTIVE_PREVIEWS[kind];
    md.block.ruler.before('fence', name, (state: StateBlock, startLine: number, endLine: number, silent: boolean) => {
      const startPos = state.bMarks[startLine]! + state.tShift[startLine]!;
      const opened = state.src.slice(startPos, state.eMarks[startLine]).match(opener);
      if (!opened) return false;
      if (silent) return true;

      // The closing `:::`.
      let nextLine = startLine + 1;
      let found = false;
      while (nextLine < endLine) {
        const line = state.src.slice(state.bMarks[nextLine]! + state.tShift[nextLine]!, state.eMarks[nextLine]).trim();
        if (line === ':::') {
          found = true;
          break;
        }
        nextLine++;
      }
      if (!found) return false;

      const body = state.src.slice(state.bMarks[startLine + 1], state.bMarks[nextLine]).trim();
      const token = state.push(name, 'div', 0);
      preview.fill(token, opened, body);
      token.map = [startLine, nextLine + 1];
      state.line = nextLine + 1;
      return true;
    });
    md.renderer.rules[name] = (tokens: Token[], idx: number) => preview.render(tokens[idx]!);
  }
}
