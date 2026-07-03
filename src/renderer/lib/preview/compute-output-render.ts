/**
 * Compute-output rendering + clipboard helpers extracted from
 * Preview.svelte (#672, #238/#243/#244). `renderComputeOutput` produces
 * the shape-specific HTML for a ```output fence; `findSourceFenceBefore`
 * locates the runnable fence that produced it; `tableToCsv` /
 * `outputToMarkdownClipboard` back the overflow-menu copy actions. Pure —
 * `renderComputeOutput` uses the browser `btoa`/`unescape`/
 * `encodeURIComponent` globals, which are available in the renderer.
 */
import type Token from 'markdown-it/lib/token.mjs';
import { escapeHtml, escapeAttr } from './text';
import { sanitizeComputeOutputHtml } from '../compute-output-sanitize';
import type { CellOutput } from '../../../shared/compute/types';
import { RUNNABLE_LANGUAGE_SET } from '../../../shared/compute/fences';

/**
 * Walk backwards from the output fence token to find the executable
 * fence that produced it. Returns null when anything other than
 * whitespace sits between the two — a loose sanity check that keeps
 * us from wiring a Save-as-note action to the wrong source when users
 * paste an isolated output block.
 */
export function findSourceFenceBefore(tokens: Token[], idx: number): { language: string; code: string } | null {
  for (let i = idx - 1; i >= 0; i--) {
    const t = tokens[i];
    if (t.type === 'fence') {
      const lang = (t.info ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
      if (RUNNABLE_LANGUAGE_SET.has(lang)) {
        return { language: lang, code: (t.content ?? '').replace(/\n$/, '') };
      }
      return null;
    }
    // Any heading / paragraph / blockquote between the two fences means
    // the output block isn't adjacent to a runnable source — bail.
    if (t.type === 'paragraph_open' || t.type === 'heading_open' ||
        t.type === 'blockquote_open' || t.type === 'bullet_list_open' ||
        t.type === 'ordered_list_open') {
      return null;
    }
  }
  return null;
}

export function renderComputeOutput(content: string, source: { language: string; code: string } | null): string {
  let payload: unknown;
  try {
    payload = JSON.parse(content.trim());
  } catch {
    return `<pre class="compute-output compute-output-raw">${escapeHtml(content)}</pre>`;
  }
  const p = payload as { type?: string } & Record<string, unknown>;
  let inner: string;
  let saveable = false;
  if (!p || typeof p !== 'object' || typeof p.type !== 'string') {
    inner = `<pre class="compute-output compute-output-json">${escapeHtml(JSON.stringify(payload, null, 2))}</pre>`;
  } else if (p.type === 'error') {
    const message = typeof p.message === 'string' ? p.message : JSON.stringify(p.message);
    inner = `<div class="compute-output compute-output-error">${escapeHtml(message)}</div>`;
    // Errors aren't worth saving as notes; skip the overflow menu.
  } else if (p.type === 'text') {
    const value = typeof p.value === 'string' ? p.value : JSON.stringify(p.value);
    inner = `<pre class="compute-output compute-output-text">${escapeHtml(value)}</pre>`;
    saveable = true;
  } else if (p.type === 'table' && Array.isArray(p.columns) && Array.isArray(p.rows)) {
    const columns = p.columns as string[];
    const rows = p.rows as Array<Array<string | number | boolean | null>>;
    const totalRows = typeof p.totalRows === 'number' ? p.totalRows : null;
    const truncated = p.truncated === true;
    const headers = columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
    const body = rows.map((r) => {
      const cells = r.map((v) => `<td>${escapeHtml(v == null ? '' : String(v))}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    // Truncation footer (#243): when the kernel capped rows, surface
    // the gap so the user knows there's more data than they can see
    // and can re-run with `df.tail(...)` / `.iloc[]` if they need it.
    const footer = truncated && totalRows
      ? `<p class="compute-output-truncation">Showing ${rows.length} of ${totalRows} rows · ${totalRows - rows.length} more hidden</p>`
      : '';
    inner = `<div class="compute-output-table-wrap"><table class="compute-output compute-output-table"><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table>${footer}</div>`;
    saveable = true;
  } else if (p.type === 'json') {
    inner = `<pre class="compute-output compute-output-json">${escapeHtml(JSON.stringify(p.value, null, 2))}</pre>`;
    saveable = true;
  } else if (p.type === 'image' && (p.mime === 'image/png' || p.mime === 'image/svg+xml')) {
    // Inline image (#243). PNG → data URL with base64 payload; SVG →
    // raw markup wrapped in a div so the host stylesheet can scope it.
    // Click-to-zoom toggles a `.zoomed` class via the global compute
    // output click handler (App.svelte) — same affordance as save-as-note.
    const data = typeof p.data === 'string' ? p.data : '';
    if (p.mime === 'image/png') {
      inner = `<img class="compute-output compute-output-image" src="data:image/png;base64,${escapeAttr(data)}" alt="cell output" />`;
    } else {
      // SVG: insert raw markup. SVG is rendered inline, so any embedded
      // <script> would execute. Sanitize with the same DOMPurify config
      // the html branch uses.
      const safe = sanitizeComputeOutputHtml(data);
      inner = `<div class="compute-output compute-output-svg">${safe}</div>`;
    }
    saveable = true;
  } else if (p.type === 'html' && typeof p.html === 'string') {
    // _repr_html_ output (Seaborn styled tables, IPython.display.HTML, …).
    // DOMPurify with a strict allowlist — no <script>, no <iframe>,
    // no event handlers — so a malformed _repr_html_ from a user-side
    // library can't escape the output container.
    const safe = sanitizeComputeOutputHtml(p.html);
    inner = `<div class="compute-output compute-output-html">${safe}</div>`;
    saveable = true;
  } else {
    // Unknown type — show the raw JSON so the user can tell what came back.
    inner = `<pre class="compute-output compute-output-json">${escapeHtml(JSON.stringify(payload, null, 2))}</pre>`;
  }

  // Wrap the rendered output with a ⋯ overflow-menu button when we have
  // enough context to offer save/copy actions — the output payload
  // parses cleanly, its type is saveable, and we found the source
  // fence it came from (so we know what cell to attribute back).
  if (saveable && source) {
    const outputB64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    const codeB64 = btoa(unescape(encodeURIComponent(source.code)));
    return `<div class="compute-output-wrap" data-source-language="${escapeAttr(source.language)}" data-source-code-b64="${outputB64.length > 0 ? codeB64 : ''}" data-output-b64="${outputB64}">
        <button class="compute-output-menu-btn" type="button" title="Output options">⋯</button>
        ${inner}
      </div>`;
  }
  return inner;
}

/**
 * RFC-4180-ish CSV: quote fields containing commas, quotes, or
 * newlines; double internal quotes; CRLF row terminator. Pasted into
 * Excel / Numbers / Sheets it parses back to the original table.
 */
export function tableToCsv(
  columns: string[],
  rows: Array<Array<string | number | boolean | null>>,
): string {
  const escape = (v: string | number | boolean | null): string => {
    if (v == null) return '';
    const s = String(v);
    if (/[",\r\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const lines = [columns.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))];
  return lines.join('\r\n');
}

export function outputToMarkdownClipboard(output: CellOutput): string {
  if (output.type === 'table') {
    if (output.columns.length === 0) return '*(empty result)*';
    const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    const header = `| ${output.columns.map(esc).join(' | ')} |`;
    const divider = `| ${output.columns.map(() => '---').join(' | ')} |`;
    const body = output.rows.map((r) =>
      `| ${r.map((v) => esc(v == null ? '' : String(v))).join(' | ')} |`,
    );
    return [header, divider, ...body].join('\n');
  }
  if (output.type === 'text') return '```\n' + output.value.replace(/\n$/, '') + '\n```';
  if (output.type === 'json') return '```json\n' + JSON.stringify(output.value, null, 2) + '\n```';
  return '```\n' + JSON.stringify(output) + '\n```';
}
