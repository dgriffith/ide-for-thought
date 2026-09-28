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
 *   - Context:        {{#context}} … {{/context}}          (routes to the user turn)
 *
 * Truthiness: an object slot (`note`, `claim`) is truthy when present; a
 * string slot is truthy when non-empty. Unknown variables render empty in the
 * default (lenient) mode, or are collected for reporting in strict mode — used
 * by skill validation, never at render time.
 *
 * Whitespace: a block tag that sits alone on its line ("standalone") consumes
 * that whole line, so authoring `{{#if x}}` on its own line doesn't leave a
 * blank line behind when the block is taken or skipped — matching Mustache.
 *
 * ## Two channels: instructions and material (#2438)
 *
 * A render produces two outputs. `text` is everything outside `{{#context}}`
 * blocks: for a conversation skill's body that is the SYSTEM prompt, for a
 * one-shot skill's body the system prompt of its single call, and for
 * `firstMessage` the visible first chat turn. `context` is the rendered
 * `{{#context}}` blocks, sent at the start of the first USER turn. The
 * thoughtbase is untrusted (it arrives by zip import, clone and folder sync),
 * so its text must never reach the highest-privilege channel.
 *
 * Every thoughtbase-derived variable — note, selection, claim, source, and a
 * `note`-type parameter's path / title / content — renders wrapped in a
 * `<thoughtbase-content kind="…">` delimiter, with any spoofed delimiter inside
 * it neutralized (`shared/untrusted-content.ts`). There is no way to
 * interpolate one raw.
 *
 * An untrusted variable used OUTSIDE a `{{#context}}` block is auto-routed,
 * not refused: its wrapped value moves to the user-turn context and a short
 * pointer is left in its place. A user skill written before #2438 therefore
 * keeps working and still cannot put note text in the system prompt; the
 * pointer reads a little awkwardly, which is the cue to add a block. Stock
 * skills are held to zero auto-routing by
 * `tests/main/skills-untrusted-context.test.ts`.
 */

import type { ToolContext } from '../../shared/tools/types';
import { wrapUntrusted, type UntrustedKind } from '../../shared/untrusted-content';

/** Flattened, render-time view of a ToolContext. `note`/`claim` are null when
 *  absent so `{{#if note}}` reads naturally. */
export interface SkillRenderContext {
  selection: string;
  note: { content: string; title: string; path: string } | null;
  claim: { uri: string; label: string; sourceText: string } | null;
  /** Active Source viewer tab (#103). Null when no source is in context. */
  source: { id: string; title: string; body: string } | null;
  param: Record<string, string>;
  /** Ids of `note`-type parameters. Their value is a thoughtbase path and their
   *  `.title` / `.content` companions are note text, so all three are
   *  untrusted; every other `param.*` is typed or picked by the user. */
  noteParams?: readonly string[];
}

export function toRenderContext(tc: ToolContext, noteParams: readonly string[] = []): SkillRenderContext {
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
    noteParams,
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

// ---- Untrusted variables ------------------------------------------------------

const UNTRUSTED_KINDS: Record<string, UntrustedKind> = {
  selection: 'selection',
  'note.content': 'note',
  'note.title': 'note-title',
  'note.path': 'note-path',
  'claim.uri': 'claim-uri',
  'claim.label': 'claim-label',
  'claim.sourceText': 'claim-source-text',
  'source.id': 'source-id',
  'source.title': 'source-title',
  'source.body': 'source',
};

/** The delimiter kind for an untrusted variable path, or null for a trusted
 *  one (a user-typed / user-picked parameter). */
export function untrustedKind(path: string, noteParams: readonly string[] = []): UntrustedKind | null {
  const direct = UNTRUSTED_KINDS[path];
  if (direct) return direct;
  if (!path.startsWith('param.')) return null;
  const key = path.slice('param.'.length);
  const dot = key.indexOf('.');
  if (dot === -1) return noteParams.includes(key) ? 'note-path' : null;
  // A dotted param is a companion var; only `note` params have any.
  const suffix = key.slice(dot + 1);
  if (suffix === 'content') return 'note';
  if (suffix === 'title') return 'note-title';
  return 'note';
}

/** Where a wrapped value came from, as delimiter attributes. */
function untrustedAttrs(path: string, ctx: SkillRenderContext): Record<string, string | undefined> {
  if (path === 'note.content' || path === 'selection') return { path: ctx.note?.path };
  if (path === 'source.body') return { id: ctx.source?.id };
  if (path.startsWith('param.') && path.endsWith('.content')) {
    return { path: ctx.param[path.slice('param.'.length, -'.content'.length)] };
  }
  return {};
}

// ---- Tokenizer --------------------------------------------------------------

type Token =
  | { t: 'text'; v: string }
  | { t: 'var'; path: string; filters: string[]; raw: string }
  | { t: 'if'; neg: boolean; path: string }
  | { t: 'else' }
  | { t: 'endif' }
  | { t: 'ctx' }
  | { t: 'endctx' };

const MUSTACHE = /\{\{([^}]*)\}\}/g;

function tokenize(template: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  MUSTACHE.lastIndex = 0;
  while ((m = MUSTACHE.exec(template)) !== null) {
    if (m.index > last) tokens.push({ t: 'text', v: template.slice(last, m.index) });
    // The single capture group always matches (possibly empty) when exec succeeds.
    const inner = m[1]!.trim();
    if (inner.startsWith('#if ') || inner.startsWith('#if\t')) {
      let expr = inner.slice(3).trim();
      const neg = expr.startsWith('!');
      if (neg) expr = expr.slice(1).trim();
      tokens.push({ t: 'if', neg, path: expr });
    } else if (inner === 'else') {
      tokens.push({ t: 'else' });
    } else if (inner === '/if') {
      tokens.push({ t: 'endif' });
    } else if (inner === '#context') {
      tokens.push({ t: 'ctx' });
    } else if (inner === '/context') {
      tokens.push({ t: 'endctx' });
    } else {
      const parts = inner.split('|').map((p) => p.trim());
      const path = parts[0]!; // split always yields at least one element
      const filters = parts.slice(1).filter(Boolean);
      tokens.push({ t: 'var', path, filters, raw: m[1]!.trim() });
    }
    last = m.index + m[0].length;
  }
  if (last < template.length) tokens.push({ t: 'text', v: template.slice(last) });
  return tokens;
}

/**
 * Standalone-block whitespace cleanup. When a block tag (if/else/endif,
 * context open/close) is the only non-whitespace content on its line, drop the
 * indentation before it and the single newline after it, so the tag leaves no
 * blank line behind.
 */
function trimStandalone(tokens: Token[]): Token[] {
  const isBlock = (tk: Token) =>
    tk.t === 'if' || tk.t === 'else' || tk.t === 'endif' || tk.t === 'ctx' || tk.t === 'endctx';
  for (let i = 0; i < tokens.length; i++) {
    if (!isBlock(tokens[i]!)) continue;
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
  | { t: 'if'; neg: boolean; path: string; then: Node[]; else: Node[] }
  | { t: 'ctx'; body: Node[] };

function parse(tokens: Token[]): Node[] {
  let pos = 0;
  let inContext = false;

  function parseSeq(stopOnElse: boolean): Node[] {
    const nodes: Node[] = [];
    while (pos < tokens.length) {
      const tk = tokens[pos]!; // bounded by the while condition
      if (tk.t === 'endif' || tk.t === 'endctx') return nodes;
      if (tk.t === 'else' && stopOnElse) return nodes;
      if (tk.t === 'else') throw new Error('Template: unexpected {{else}} without matching {{#if}}');
      if (tk.t === 'ctx') {
        if (inContext) throw new Error('Template: {{#context}} blocks do not nest');
        pos++; // consume the open
        inContext = true;
        const body = parseSeq(false);
        inContext = false;
        const endTk = tokens[pos];
        if (!endTk || endTk.t !== 'endctx') {
          throw new Error(
            endTk
              ? 'Template: {{/if}} closes a block opened outside its {{#context}}'
              : 'Template: unclosed {{#context}} (missing {{/context}})',
          );
        }
        pos++; // consume the close
        nodes.push({ t: 'ctx', body });
        continue;
      }
      if (tk.t === 'if') {
        pos++; // consume the if
        const thenNodes = parseSeq(true);
        let elseNodes: Node[] = [];
        const afterThen = tokens[pos];
        if (afterThen && afterThen.t === 'else') {
          pos++; // consume else
          elseNodes = parseSeq(false);
        }
        const endTk = tokens[pos];
        if (!endTk || endTk.t !== 'endif') {
          throw new Error(
            endTk
              ? `Template: {{/context}} closes before {{#if ${tk.path}}} does`
              : `Template: unclosed {{#if ${tk.path}}} (missing {{/if}})`,
          );
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
    // Only reachable via a stray {{/if}} / {{/context}}.
    throw new Error(
      tokens[pos]!.t === 'endctx'
        ? 'Template: unexpected {{/context}} without matching {{#context}}'
        : 'Template: unexpected {{/if}} without matching {{#if}}',
    );
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
  /** Everything outside `{{#context}}` blocks — the instruction channel. */
  text: string;
  /** Each rendered `{{#context}}` block (plus any auto-routed values), in
   *  order — the material for the first user turn. */
  context: string[];
  errors: string[];
  /** Untrusted variables that appeared outside a `{{#context}}` block and were
   *  auto-routed. Empty for every stock skill. */
  autoRouted: string[];
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

/** Tidy one channel after context blocks were lifted out of it: the blank
 *  lines around a removed block would otherwise pile up. */
function tidy(s: string): string {
  return s.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
}

/** Render with diagnostics — never throws on unknown vars/filters; collects
 *  them in `errors`. Use for skill validation. */
export function renderTemplateDiagnostic(
  template: string,
  ctx: SkillRenderContext,
): RenderResult {
  const errors: string[] = [];
  const context: string[] = [];
  const autoRouted: string[] = [];
  const nodes = parseTemplate(template);
  const noteParams = ctx.noteParams ?? [];
  let sawContext = false;

  function renderVar(n: Extract<Node, { t: 'var' }>, inContext: boolean): string {
    const v = resolve(n.path, ctx);
    if (v === undefined) {
      errors.push(`unknown variable "${n.raw}"`);
      return ''; // lenient: render empty
    }
    const str = applyFilters(typeof v === 'string' ? v : '', n.filters, errors);
    const kind = untrustedKind(n.path, noteParams);
    if (!kind) return str;
    if (str.length === 0) return '';
    const wrapped = wrapUntrusted(kind, str, untrustedAttrs(n.path, ctx));
    if (inContext) return wrapped;
    // Auto-route: the value goes to the user turn; the instruction channel
    // keeps a pointer to it.
    autoRouted.push(n.path);
    if (!context.includes(wrapped)) context.push(wrapped);
    return `(the ${kind.replace(/-/g, ' ')} is in the user message, in a <thoughtbase-content kind="${kind}"> block)`;
  }

  function render(ns: Node[], inContext: boolean): string {
    let out = '';
    for (const n of ns) {
      if (n.t === 'text') {
        out += n.v;
      } else if (n.t === 'var') {
        out += renderVar(n, inContext);
      } else if (n.t === 'ctx') {
        sawContext = true;
        const block = tidy(render(n.body, true).replace(/^\s*\n/, ''));
        if (block.length > 0) context.push(block);
      } else {
        const cond = resolve(n.path, ctx);
        if (cond === undefined) errors.push(`unknown condition "${n.path}"`);
        const t = truthy(cond);
        out += render(n.neg ? (t ? n.else : n.then) : t ? n.then : n.else, inContext);
      }
    }
    return out;
  }

  const raw = render(nodes, false);
  // A template with no context block (and nothing auto-routed) renders
  // byte-for-byte as it always did.
  const text = sawContext || autoRouted.length > 0 ? tidy(raw) : raw;
  return { text, context, errors, autoRouted };
}

/** Render a skill template against a context — the instruction channel only.
 *  Unknown vars/filters render empty (lenient). Throws only on structural
 *  errors (unbalanced blocks). */
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
    parse(tokens); // structural check (balanced #if/else//if, #context//context)
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
