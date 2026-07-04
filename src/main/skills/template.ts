/**
 * Prompt template engine for skill files (#623, part of #622).
 *
 * Skill bodies and `firstMessage` strings are static markdown that must
 * reproduce what the old hardcoded `buildSystemPrompt(ctx)` / `buildPrompt(ctx)`
 * functions composed at runtime: note content, the editor selection, the
 * claim under the cursor, and parameter values — plus "no-note" variants and
 * a few text transforms (notably blockquoting a claim's source passage).
 *
 * The language is deliberately small and non-executing:
 *
 *   - Interpolation:  {{selection}}  {{note.title}}  {{param.audience}}
 *   - Filters:        {{claim.sourceText | blockquote}}
 *   - Conditionals:   {{#if note}} … {{else}} … {{/if}}   (nestable, `!` negates)
 *
 * Truthiness: an object slot (`note`, `claim`) is truthy when present; a
 * string slot is truthy when non-empty. Unknown variables render empty in the
 * default (lenient) mode, or are collected for reporting in strict mode — used
 * by skill validation, never at render time.
 *
 * Whitespace: a block tag that sits alone on its line ("standalone") consumes
 * that whole line, so authoring `{{#if x}}` on its own line doesn't leave a
 * blank line behind when the block is taken or skipped — matching Mustache.
 */

import type { ToolContext } from '../../shared/tools/types';

/** Flattened, render-time view of a ToolContext. `note`/`claim` are null when
 *  absent so `{{#if note}}` reads naturally. */
export interface SkillRenderContext {
  selection: string;
  note: { content: string; title: string; path: string } | null;
  claim: { uri: string; label: string; sourceText: string } | null;
  /** Active Source viewer tab (#103). Null when no source is in context. */
  source: { id: string; title: string; body: string } | null;
  param: Record<string, string>;
}

export function toRenderContext(tc: ToolContext): SkillRenderContext {
  return {
    selection: tc.selectedText ?? '',
    note: tc.fullNoteContent
      ? {
          content: tc.fullNoteContent,
          title: tc.fullNoteTitle ?? '',
          path: tc.fullNotePath ?? '',
        }
      : null,
    claim: tc.claimUri
      ? {
          uri: tc.claimUri,
          label: tc.claimLabel ?? '',
          sourceText: tc.claimSourceText ?? '',
        }
      : null,
    source: tc.sourceId
      ? {
          id: tc.sourceId,
          title: tc.sourceTitle ?? '',
          body: tc.sourceBody ?? '',
        }
      : null,
    param: tc.parameterValues ?? {},
  };
}

// ---- Filters ----------------------------------------------------------------

type Filter = (input: string) => string;

const FILTERS: Record<string, Filter> = {
  // Prefix every line with "> " so a multi-line passage renders as one
  // markdown blockquote. Mirrors the old find-arguments builder.
  blockquote: (s) => s.split(/\r?\n/).map((l) => `> ${l}`).join('\n'),
  trim: (s) => s.trim(),
  upper: (s) => s.toUpperCase(),
  lower: (s) => s.toLowerCase(),
  // Drop a trailing `.md` — turns a note path into its wiki-link target,
  // mirroring the research builders' `path.replace(/\.md$/i, '')`.
  stem: (s) => s.replace(/\.md$/i, ''),
};

export const KNOWN_FILTERS: readonly string[] = Object.keys(FILTERS);

// ---- Tokenizer --------------------------------------------------------------

type Token =
  | { t: 'text'; v: string }
  | { t: 'var'; path: string; filters: string[]; raw: string }
  | { t: 'if'; neg: boolean; path: string }
  | { t: 'else' }
  | { t: 'endif' };

const MUSTACHE = /\{\{([^}]*)\}\}/g;

function tokenize(template: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  MUSTACHE.lastIndex = 0;
  while ((m = MUSTACHE.exec(template)) !== null) {
    if (m.index > last) tokens.push({ t: 'text', v: template.slice(last, m.index) });
    const inner = m[1].trim();
    if (inner.startsWith('#if ') || inner.startsWith('#if\t')) {
      let expr = inner.slice(3).trim();
      const neg = expr.startsWith('!');
      if (neg) expr = expr.slice(1).trim();
      tokens.push({ t: 'if', neg, path: expr });
    } else if (inner === 'else') {
      tokens.push({ t: 'else' });
    } else if (inner === '/if') {
      tokens.push({ t: 'endif' });
    } else {
      const parts = inner.split('|').map((p) => p.trim());
      const path = parts[0];
      const filters = parts.slice(1).filter(Boolean);
      tokens.push({ t: 'var', path, filters, raw: m[1].trim() });
    }
    last = m.index + m[0].length;
  }
  if (last < template.length) tokens.push({ t: 'text', v: template.slice(last) });
  return tokens;
}

/**
 * Standalone-block whitespace cleanup. When a block tag (if/else/endif) is the
 * only non-whitespace content on its line, drop the indentation before it and
 * the single newline after it, so the tag leaves no blank line behind.
 */
function trimStandalone(tokens: Token[]): Token[] {
  const isBlock = (tk: Token) => tk.t === 'if' || tk.t === 'else' || tk.t === 'endif';
  for (let i = 0; i < tokens.length; i++) {
    if (!isBlock(tokens[i])) continue;
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    const prevText = prev && prev.t === 'text' ? prev.v : i === 0 ? '' : null;
    const nextText = next && next.t === 'text' ? next.v : i === tokens.length - 1 ? '' : null;
    const prevOk = prevText !== null && (prevText === '' || /(^|\n)[ \t]*$/.test(prevText));
    const nextOk = nextText !== null && (nextText === '' || /^[ \t]*\r?\n/.test(nextText));
    if (prevOk && nextOk) {
      if (prev && prev.t === 'text') prev.v = prev.v.replace(/[ \t]*$/, '');
      if (next && next.t === 'text') next.v = next.v.replace(/^[ \t]*\r?\n/, '');
    }
  }
  return tokens;
}

// ---- Parser -----------------------------------------------------------------

type Node =
  | { t: 'text'; v: string }
  | { t: 'var'; path: string; filters: string[]; raw: string }
  | { t: 'if'; neg: boolean; path: string; then: Node[]; else: Node[] };

function parse(tokens: Token[]): Node[] {
  let pos = 0;

  function parseSeq(stopOnElse: boolean): Node[] {
    const nodes: Node[] = [];
    while (pos < tokens.length) {
      const tk = tokens[pos];
      if (tk.t === 'endif') return nodes;
      if (tk.t === 'else' && stopOnElse) return nodes;
      if (tk.t === 'else') throw new Error('Template: unexpected {{else}} without matching {{#if}}');
      if (tk.t === 'if') {
        pos++; // consume the if
        const thenNodes = parseSeq(true);
        let elseNodes: Node[] = [];
        if (tokens[pos] && tokens[pos].t === 'else') {
          pos++; // consume else
          elseNodes = parseSeq(false);
        }
        if (!tokens[pos] || tokens[pos].t !== 'endif') {
          throw new Error(`Template: unclosed {{#if ${tk.path}}} (missing {{/if}})`);
        }
        pos++; // consume endif
        nodes.push({ t: 'if', neg: tk.neg, path: tk.path, then: thenNodes, else: elseNodes });
        continue;
      }
      if (tk.t === 'text') nodes.push({ t: 'text', v: tk.v });
      else if (tk.t === 'var') nodes.push({ t: 'var', path: tk.path, filters: tk.filters, raw: tk.raw });
      pos++;
    }
    return nodes;
  }

  const out = parseSeq(false);
  if (pos < tokens.length) {
    // Only reachable via a stray {{/if}} / {{else}}.
    throw new Error('Template: unexpected {{/if}} without matching {{#if}}');
  }
  return out;
}

// ---- Resolution -------------------------------------------------------------

/** Resolve a dotted path against the context. Returns string | object | null,
 *  or `undefined` for an unknown path (so strict mode can flag it). */
function resolve(path: string, ctx: SkillRenderContext): string | object | null | undefined {
  if (path === 'selection') return ctx.selection;
  if (path === 'note') return ctx.note;
  if (path === 'claim') return ctx.claim;
  if (path.startsWith('note.')) {
    const k = path.slice(5);
    if (!ctx.note) return '';
    if (k === 'content' || k === 'title' || k === 'path') return ctx.note[k];
    return undefined;
  }
  if (path.startsWith('claim.')) {
    const k = path.slice(6);
    if (!ctx.claim) return '';
    if (k === 'uri' || k === 'label' || k === 'sourceText') return ctx.claim[k];
    return undefined;
  }
  if (path === 'source') return ctx.source;
  if (path.startsWith('source.')) {
    const k = path.slice(7);
    if (!ctx.source) return '';
    if (k === 'id' || k === 'title' || k === 'body') return ctx.source[k];
    return undefined;
  }
  if (path.startsWith('param.')) {
    const k = path.slice(6);
    return ctx.param[k] ?? '';
  }
  return undefined;
}

function truthy(value: string | object | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.length > 0;
  return true; // present object
}

function applyFilters(value: string, filters: string[], errors: string[]): string {
  let out = value;
  for (const f of filters) {
    const fn = FILTERS[f];
    if (!fn) {
      errors.push(`unknown filter "${f}"`);
      continue;
    }
    out = fn(out);
  }
  return out;
}

// ---- Public API -------------------------------------------------------------

export interface RenderResult {
  text: string;
  errors: string[];
}

// Parsing a template (tokenize → structural parse) depends only on its string,
// and the resulting AST is walked read-only at render time — so memoize it.
// Every skill invocation re-rendered the body from scratch before (#984); skill
// bodies are a fixed, small set, so the cache is naturally bounded.
const astCache = new Map<string, Node[]>();
function parseTemplate(template: string): Node[] {
  let nodes = astCache.get(template);
  if (nodes === undefined) {
    nodes = parse(trimStandalone(tokenize(template)));
    astCache.set(template, nodes);
  }
  return nodes;
}

/** Render with diagnostics — never throws on unknown vars/filters; collects
 *  them in `errors`. Use for skill validation. */
export function renderTemplateDiagnostic(
  template: string,
  ctx: SkillRenderContext,
): RenderResult {
  const errors: string[] = [];
  const nodes = parseTemplate(template);

  function render(ns: Node[]): string {
    let out = '';
    for (const n of ns) {
      if (n.t === 'text') {
        out += n.v;
      } else if (n.t === 'var') {
        const v = resolve(n.path, ctx);
        if (v === undefined) {
          errors.push(`unknown variable "${n.raw}"`);
          // lenient: render empty
        } else {
          const str = typeof v === 'string' ? v : v === null ? '' : '';
          out += applyFilters(str, n.filters, errors);
        }
      } else {
        const cond = resolve(n.path, ctx);
        if (cond === undefined) errors.push(`unknown condition "${n.path}"`);
        const t = truthy(cond);
        out += render(n.neg ? (t ? n.else : n.then) : t ? n.then : n.else);
      }
    }
    return out;
  }

  return { text: render(nodes), errors };
}

/** Render a skill template against a context. Unknown vars/filters render
 *  empty (lenient). Throws only on structural errors (unbalanced blocks). */
export function renderTemplate(template: string, ctx: SkillRenderContext): string {
  return renderTemplateDiagnostic(template, ctx).text;
}

const KNOWN_VAR_PATHS = new Set([
  'selection', 'note', 'note.content', 'note.title', 'note.path',
  'claim', 'claim.uri', 'claim.label', 'claim.sourceText',
  'source', 'source.id', 'source.title', 'source.body',
]);

function isKnownPath(path: string): boolean {
  if (KNOWN_VAR_PATHS.has(path)) return true;
  return path.startsWith('param.') && path.length > 'param.'.length;
}

/**
 * Context-independent validation for skill authoring (#624). Checks block
 * balance and that every variable path and filter is known — catching typos
 * like `{{note.body}}` or `{{x | blockqote}}` that lenient rendering would
 * silently swallow. Returns a list of human-readable problems (empty = valid).
 */
export function validateTemplate(template: string): string[] {
  const errors: string[] = [];
  let tokens: Token[];
  try {
    tokens = tokenize(template);
    parse(tokens); // structural check (balanced #if/else//if)
  } catch (e) {
    errors.push((e as Error).message);
    return errors;
  }
  for (const tk of tokens) {
    if (tk.t === 'var') {
      if (!isKnownPath(tk.path)) errors.push(`unknown variable "${tk.path}"`);
      for (const f of tk.filters) {
        if (!FILTERS[f]) errors.push(`unknown filter "${f}"`);
      }
    } else if (tk.t === 'if') {
      if (!isKnownPath(tk.path)) errors.push(`unknown condition "${tk.path}"`);
    }
  }
  return errors;
}
