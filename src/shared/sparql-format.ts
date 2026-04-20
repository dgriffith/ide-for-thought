/**
 * Hand-rolled SPARQL pretty-printer (#196). Not a full parser \u2014 just
 * enough of a tokenizer + emitter to canonicalise the query shapes this
 * codebase uses. String literals, IRIs in angle brackets, and comments
 * are preserved verbatim; everything else gets normalised.
 *
 * Rules applied:
 *   - PREFIX / BASE declarations each on their own line, top of query.
 *   - SELECT / CONSTRUCT / ASK / DESCRIBE and their projections on one
 *     line, followed by WHERE { on the same line.
 *   - Triple patterns in WHERE one per line, indented 2 spaces per
 *     brace-depth.
 *   - `;` / `,` continuations on their own lines at the current indent.
 *   - FILTER / OPTIONAL / UNION / MINUS / GRAPH / SERVICE on their own
 *     lines inside the block.
 *   - Trailing clauses (ORDER BY, GROUP BY, HAVING, LIMIT, OFFSET,
 *     VALUES) after the closing brace, each on its own line.
 *   - Comments stay where they were, on their own line.
 *
 * The formatter is intentionally idempotent: `format(format(x)) === format(x)`
 * for any input it produced.
 */

type TokenType =
  | 'word'       // keywords + unprefixed names (SELECT, str, …)
  | 'pname'      // prefixed names (minerva:Note, dc:title, a)
  | 'var'        // ?x, $y
  | 'iri'        // <http://…>
  | 'string'     // "…", '…', """…"""
  | 'number'     // 42, 3.14, -1
  | 'comment'    // # … (newline excluded)
  | 'punct'      // . ; , ( ) [ ] { }
  | 'operator';  // * + - < > = ! / & | ^ ? (when not a var leader)

interface Token {
  type: TokenType;
  text: string;
}

// Keywords that should begin their own line at the top level. WHERE is
// deliberately omitted — it sticks with the preceding SELECT projection
// (`SELECT ?x WHERE {` on one line) so the common shape reads cleanly.
const TOP_LEVEL_KW = new Set([
  'BASE', 'PREFIX', 'SELECT', 'CONSTRUCT', 'ASK', 'DESCRIBE',
  'FROM',
  'ORDER', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'VALUES',
]);

const BLOCK_KW = new Set([
  'FILTER', 'OPTIONAL', 'UNION', 'MINUS', 'GRAPH', 'SERVICE', 'BIND',
]);

export function formatSparql(src: string): string {
  const tokens = tokenize(src);
  if (tokens.length === 0) return src.trimEnd() + (src.endsWith('\n') ? '\n' : '');
  return emit(tokens);
}

// ── Tokenizer ────────────────────────────────────────────────────────────

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i];

    // Whitespace
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }

    // Comment: `#` through end of line
    if (c === '#') {
      const eol = src.indexOf('\n', i);
      const end = eol < 0 ? n : eol;
      out.push({ type: 'comment', text: src.slice(i, end).trimEnd() });
      i = end;
      continue;
    }

    // String literal: handle triple-quoted and single-quoted both `"` and `'`.
    if (c === '"' || c === "'") {
      const triple = src.slice(i, i + 3) === c + c + c;
      if (triple) {
        let j = i + 3;
        while (j < n && src.slice(j, j + 3) !== c + c + c) j++;
        j = Math.min(n, j + 3);
        out.push({ type: 'string', text: src.slice(i, j) });
        i = j;
      } else {
        let j = i + 1;
        let escaped = false;
        while (j < n) {
          const ch = src[j];
          if (ch === '\\' && !escaped) { escaped = true; j++; continue; }
          if (ch === c && !escaped) { j++; break; }
          escaped = false;
          j++;
        }
        out.push({ type: 'string', text: src.slice(i, j) });
        i = j;
      }
      continue;
    }

    // IRI in angle brackets — distinguish from `<` / `<=` operators by
    // peeking. An IRI is `<` followed by non-whitespace + closing `>` on
    // the same line.
    if (c === '<') {
      const next = src[i + 1];
      const looksOp = next === undefined || next === ' ' || next === '\t' || next === '\n' || next === '=';
      if (!looksOp) {
        const close = src.indexOf('>', i + 1);
        const nl = src.indexOf('\n', i + 1);
        if (close > 0 && (nl < 0 || close < nl)) {
          out.push({ type: 'iri', text: src.slice(i, close + 1) });
          i = close + 1;
          continue;
        }
      }
      // Operator `<` or `<=`
      if (next === '=') {
        out.push({ type: 'operator', text: '<=' });
        i += 2;
      } else {
        out.push({ type: 'operator', text: '<' });
        i++;
      }
      continue;
    }

    // Variable: ?x or $x
    if (c === '?' || c === '$') {
      // Standalone `?` (no identifier after) — treat as operator.
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_\u00C0-\uFFFD]/.test(src[j])) j++;
      if (j === i + 1) {
        out.push({ type: 'operator', text: c });
        i = j;
      } else {
        out.push({ type: 'var', text: src.slice(i, j) });
        i = j;
      }
      continue;
    }

    // Number: optional sign handled by preceding operator token.
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < n && /[0-9.eE+-]/.test(src[j])) j++;
      out.push({ type: 'number', text: src.slice(i, j) });
      i = j;
      continue;
    }

    // Single-char punctuation
    if ('.;,(){}[]'.includes(c)) {
      out.push({ type: 'punct', text: c });
      i++;
      continue;
    }

    // Operators
    if ('*+-/=!&|^'.includes(c)) {
      // Check for `>=`, `!=`, `||`, `&&`
      const two = src.slice(i, i + 2);
      if (two === '!=' || two === '>=' || two === '||' || two === '&&') {
        out.push({ type: 'operator', text: two });
        i += 2;
      } else {
        out.push({ type: 'operator', text: c });
        i++;
      }
      continue;
    }

    if (c === '>') {
      const two = src.slice(i, i + 2);
      if (two === '>=') {
        out.push({ type: 'operator', text: '>=' });
        i += 2;
      } else {
        out.push({ type: 'operator', text: '>' });
        i++;
      }
      continue;
    }

    // Word (identifier, keyword, prefixed name). Consume letters/digits/`_`/
    // `:`/`-`/`.` (dots inside pname-ns or local names).
    if (/[A-Za-z_:]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_:.\-]/.test(src[j])) j++;
      const text = src.slice(i, j).replace(/\.+$/, (dots) => {
        // Trailing dots belong to the statement terminator, not the name.
        return dots === '' ? '' : '';
      });
      const realEnd = i + text.length;
      const type: TokenType = text.includes(':') ? 'pname' : 'word';
      out.push({ type, text });
      i = realEnd;
      continue;
    }

    // Unknown character — skip defensively so we never infinite-loop.
    i++;
  }

  return out;
}

// ── Emitter ──────────────────────────────────────────────────────────────

function isKeyword(tok: Token, ...names: string[]): boolean {
  if (tok.type !== 'word') return false;
  const upper = tok.text.toUpperCase();
  return names.includes(upper);
}

function emit(tokens: Token[]): string {
  let out = '';
  let line = '';
  let depth = 0;
  /** Set when we\u2019ve emitted the continuation punct (`;` / `,`) and the next token should sit on a fresh indented line. */
  let pendingContinuation = false;

  function flush() {
    if (line.trim() === '') { line = ''; return; }
    out += line.trimEnd() + '\n';
    line = '';
  }

  function startLine(extraIndent = 0) {
    flush();
    line = '  '.repeat(depth + extraIndent);
  }

  function appendToken(tokText: string, glue: 'space' | 'none' = 'space') {
    if (line.length > 0 && line.trimEnd() === line && glue === 'space') {
      line += ' ';
    }
    line += tokText;
  }

  // Top-level loop.
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const prev = tokens[i - 1];
    const upper = tok.type === 'word' ? tok.text.toUpperCase() : '';

    // Comments always on their own line, at the current indent.
    if (tok.type === 'comment') {
      if (line.trim() !== '') flush();
      line = '  '.repeat(depth) + tok.text;
      flush();
      continue;
    }

    // `}` closes a block: flush current line, outdent, emit `}` on own line.
    if (tok.type === 'punct' && tok.text === '}') {
      flush();
      depth = Math.max(0, depth - 1);
      pendingContinuation = false;
      line = '  '.repeat(depth) + '}';
      // Trailing clauses (ORDER/GROUP/HAVING/LIMIT/OFFSET/VALUES) after the
      // closing brace get flushed onto their own new lines below.
      continue;
    }

    // Top-level clause keywords always begin a new line (except the very
    // first line, when the line buffer is still empty).
    if (tok.type === 'word' && TOP_LEVEL_KW.has(upper) && line.trim() !== '') {
      flush();
      line = '  '.repeat(depth);
    }

    // Block keywords inside a WHERE body begin a new indented line.
    if (tok.type === 'word' && BLOCK_KW.has(upper) && line.trim() !== '' && depth > 0) {
      flush();
      line = '  '.repeat(depth);
    }

    // After a continuation (`;` / `,`), the next real token starts a fresh
    // line at the current indent.
    if (pendingContinuation && !(tok.type === 'punct' && tok.text === '}')) {
      flush();
      line = '  '.repeat(depth);
      pendingContinuation = false;
    }

    // Trigger a new indented line after `{` opens a block.
    if (tok.type === 'punct' && tok.text === '{') {
      if (line.trim() === '') {
        line = '  '.repeat(depth) + '{';
      } else {
        line = line.trimEnd() + ' {';
      }
      flush();
      depth++;
      line = '  '.repeat(depth);
      continue;
    }

    // Statement terminator `.` \u2014 attach to current line, flush, next line.
    if (tok.type === 'punct' && tok.text === '.') {
      line = line.trimEnd() + ' .';
      flush();
      line = '  '.repeat(depth);
      continue;
    }

    // `;` / `,` continuations \u2014 attach to current line, set flag so the
    // next token opens a fresh indented line.
    if (tok.type === 'punct' && (tok.text === ';' || tok.text === ',')) {
      line = line.trimEnd() + ' ' + tok.text;
      pendingContinuation = true;
      continue;
    }

    // `(` / `)` / `[` / `]` \u2014 no space around when adjacent to an
    // expression boundary.
    if (tok.type === 'punct' && tok.text === '(') {
      // Keep tight to prior word (e.g. DESC(?x), COUNT(?y)).
      if (line.trim() !== '' && prev && (prev.type === 'word' || prev.type === 'pname')) {
        line += '(';
      } else if (line.trim() === '') {
        line = '  '.repeat(depth) + '(';
      } else {
        line += ' (';
      }
      continue;
    }
    if (tok.type === 'punct' && tok.text === ')') {
      line = line.trimEnd() + ')';
      continue;
    }
    if (tok.type === 'punct' && tok.text === '[') {
      if (line.trim() === '') line = '  '.repeat(depth) + '[';
      else line += ' [';
      continue;
    }
    if (tok.type === 'punct' && tok.text === ']') {
      line = line.trimEnd() + ']';
      continue;
    }

    // Default emission: word/pname/var/iri/string/number/operator.
    const prevText = prev ? prev.text : '';
    const prevType = prev ? prev.type : null;
    // Decide whether to add a separating space.
    let needSpace = line.trim() !== '' && !line.endsWith(' ');
    // Suppress space after open delimiters.
    if (prevType === 'punct' && (prevText === '(' || prevText === '[')) needSpace = false;
    // Suppress space after unary operators that hug their operand.
    if (prevType === 'operator' && (prevText === '!' || prevText === '-' || prevText === '+')
        && (tok.type === 'var' || tok.type === 'number' || tok.type === 'pname' || tok.type === 'iri')) {
      // Only apply unary-hug when operator is clearly unary \u2014 i.e. at the
      // start of an argument (preceded by `(` or `,` or nothing).
      const before = i >= 2 ? tokens[i - 2] : null;
      const beforeText = before ? before.text : '';
      const beforeType = before ? before.type : null;
      if (beforeType === 'punct' && (beforeText === '(' || beforeText === ',' || beforeText === '{')) {
        needSpace = false;
      }
    }

    if (line.trim() === '') {
      line = '  '.repeat(depth) + tok.text;
    } else {
      line += (needSpace ? ' ' : '') + tok.text;
    }
  }

  flush();
  // Collapse any triple-blank gaps the state machine may have left.
  return out.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
