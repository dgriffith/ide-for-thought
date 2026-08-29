/**
 * Preview-addressability rule overrides (#1908 — split out of
 * `preview/markdown-config.ts` to finish that file's `install*` convention).
 *
 * Three renderer-rule overrides that stamp navigable ids / metadata onto
 * their tokens so `[[note#heading]]` / `[[note#^block]]` anchor navigation
 * and task-checkbox toggling can find their target in the rendered DOM:
 *
 *  - `heading_open` — id = slug(heading text), matching the indexer's
 *    heading-slug convention so a wiki-link anchor resolves to the same id.
 *  - `paragraph_open` — id = `^block-id` when the paragraph ends with a
 *    bare `^block-id` marker, which is then stripped from the rendered text.
 *  - `list_item_open` — `[ ]`/`[x]` at the start of a list item becomes a
 *    live checkbox stamped with the item's source line, so the click
 *    handler on the preview root knows which line to flip in the editor.
 *
 * None of the three need any Preview-instance state (no `PreviewMarkdownDeps`
 * dependency) — everything they read comes off the token tree markdown-it
 * itself already built.
 */
import type { MarkdownIt, Token } from 'markdown-it';
import { slugify } from '../../../shared/slug';

export function installAnchors(md: MarkdownIt): void {
    // Give every heading an id derived from its text so [[note#heading]] anchor
    // navigation can target it. Slugs must match the indexer's convention.
    const defaultHeadingOpen = md.renderer.rules.heading_open;
    md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
        const inline = tokens[idx + 1];
        const text = inline && inline.type === 'inline' ? inline.content : '';
        const slug = slugify(text);
        if (slug) tokens[idx]!.attrSet('id', slug);
        return defaultHeadingOpen
            ? defaultHeadingOpen(tokens, idx, options, env, self)
            : self.renderToken(tokens, idx, options);
    };

    // Watch for block-id paragraphs (`^block-id` at paragraph end) and mirror
    // them onto the rendered <p> so [[note#^id]] scrolls can find the target.
    const BLOCK_ID_RE = /\s*\^([\w-]+)\s*$/;
    const defaultParagraphOpen = md.renderer.rules.paragraph_open;
    md.renderer.rules.paragraph_open = (tokens, idx, options, env, self) => {
        const inline = tokens[idx + 1];
        if (inline && inline.type === 'inline') {
            const m = inline.content.match(BLOCK_ID_RE);
            if (m) {
                tokens[idx]!.attrSet('id', `^${m[1]}`);
                // Strip the marker from what renders.
                inline.content = inline.content.replace(BLOCK_ID_RE, '');
                if (inline.children) {
                    for (let i = inline.children.length - 1; i >= 0; i--) {
                        const child = inline.children[i]!;
                        if (child.type === 'text') {
                            const stripped = child.content.replace(BLOCK_ID_RE, '');
                            if (stripped !== child.content) {
                                child.content = stripped;
                                break;
                            }
                        }
                    }
                }
            }
        }
        return defaultParagraphOpen
            ? defaultParagraphOpen(tokens, idx, options, env, self)
            : self.renderToken(tokens, idx, options);
    };

    // Task-list items: when a list item starts with `[ ]` or `[x]`, render a
    // live <input type="checkbox"> and stamp `data-task-line` with the source
    // line (from the list_item_open token's `map`) so the click handler on
    // the preview root knows which line to flip in the editor store (#127).
    const TASK_ITEM_RE = /^\[([ xX])\]\s/;
    const defaultListItemOpen = md.renderer.rules.list_item_open;
    md.renderer.rules.list_item_open = (tokens, idx, options, env, self) => {
        // Scan forward to the first inline token inside this list item (typical
        // structure: list_item_open → paragraph_open → inline). Stop if we hit
        // the matching close without finding one.
        let k = idx + 1;
        while (k < tokens.length && tokens[k]!.type !== 'inline' && tokens[k]!.type !== 'list_item_close') k++;
        const inlineTok = k < tokens.length && tokens[k]!.type === 'inline' ? tokens[k]! : null;
        if (inlineTok) {
            const m = inlineTok.content.match(TASK_ITEM_RE);
            if (m) {
                const checked = m[1] === 'x' || m[1] === 'X';
                // `map[0]` is 0-indexed within whatever source was passed to
                // `md.render` — which is the frontmatter-stripped content below.
                // Add the env-carried offset so the checkbox's data-task-line
                // points at the line index in the original note.
                const rawLine = tokens[idx]!.map?.[0] ?? -1;
                const line = rawLine >= 0 ? rawLine + ((env as { lineOffset?: number })?.lineOffset ?? 0) : -1;
                tokens[idx]!.attrSet('data-task-line', String(line));
                tokens[idx]!.attrJoin('class', 'task-list-item');
                // Strip the `[ ]` prefix from the inline's aggregate content and
                // from its first text child so the rendered output doesn't repeat it.
                inlineTok.content = inlineTok.content.replace(TASK_ITEM_RE, '');
                if (inlineTok.children) {
                    for (let i = 0; i < inlineTok.children.length; i++) {
                        const child = inlineTok.children[i]!;
                        if (child.type === 'text') {
                            child.content = child.content.replace(TASK_ITEM_RE, '');
                            break;
                        }
                    }
                    // Inject the checkbox as an html_inline prefix on the inline tree.
                    // Recover the Token constructor from the inline token itself so we
                    // don't have to deep-import `markdown-it/lib/token.mjs` (#347).
                    const TokenCtor = inlineTok.constructor as new (
                        type: string, tag: string, nesting: -1 | 0 | 1,
                    ) => Token;
                    const cb = new TokenCtor('html_inline', '', 0);
                    cb.content = `<input type="checkbox" data-task-line="${line}"${checked ? ' checked' : ''}> `;
                    inlineTok.children.unshift(cb);
                }
            }
        }
        return defaultListItemOpen
            ? defaultListItemOpen(tokens, idx, options, env, self)
            : self.renderToken(tokens, idx, options);
    };
}
