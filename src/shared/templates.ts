/**
 * Template variable substitution for note templates (#475).
 *
 * Templates are plain markdown with `{{var}}` placeholders that the
 * engine expands at insertion time. Supported variables:
 *
 *   {{title}}           — the new note's title
 *   {{date}}            — current date, default ISO YYYY-MM-DD
 *   {{date:FMT}}        — current date, formatted with FMT
 *   {{time}}            — current time, default HH:mm
 *   {{time:FMT}}        — current time, formatted with FMT
 *   {{cursor}}          — placement marker; removed from output, the
 *                         resulting offset is returned so the caller
 *                         can position the caret on open
 *   {{prompt:Label}}    — interactive: the caller's `prompt` resolver
 *                         is invoked with `Label`; the user's input
 *                         replaces the placeholder. A `null` return
 *                         (user cancelled) propagates as
 *                         `cancelled: true` and substitution stops
 *
 * Literal `{{` in template output is written `\{{`; the engine drops
 * the backslash and emits `{{`. This is the project-wide
 * `{{`-handling convention — see CLAUDE.md, where the Svelte template
 * gotcha lives in a different layer but the same character pair.
 *
 * Format tokens for `date` / `time` are the conventional subset:
 *
 *   YYYY  4-digit year         HH    2-digit hour (24h)
 *   YY    2-digit year         mm    2-digit minute
 *   MM    2-digit month        ss    2-digit second
 *   DD    2-digit day
 *   MMM   short month name (Jan, Feb…)
 *
 * Anything else in FMT is preserved literally.
 */

export interface SubstitutionContext {
  /** Title to substitute for `{{title}}`. */
  title: string;
  /** Used for `{{date}}` / `{{time}}` substitution. Defaults to `new Date()`. */
  now?: Date;
  /** Resolver for `{{prompt:Label}}`. Returns `null` if the user cancels;
   *  the engine then aborts substitution and returns `cancelled: true`. */
  prompt?: (label: string) => Promise<string | null>;
}

export interface SubstitutionResult {
  /** Final template content with all placeholders resolved. */
  content: string;
  /** Character offset of the first `{{cursor}}` marker, or `null` if
   *  none was present. Offset is into the final `content`. */
  cursorOffset: number | null;
  /** True when an interactive `{{prompt:…}}` was cancelled. The
   *  partially-substituted content is still returned so the caller
   *  can inspect it, but it's usually discarded. */
  cancelled: boolean;
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Apply the conventional date / time format tokens. Anything unknown
 *  is preserved verbatim, so `[Day] DD` keeps the `[Day] ` literal. */
export function formatDateTime(fmt: string, when: Date): string {
  // Token replacement done in a single pass so longer tokens (`YYYY`,
  // `MMM`) are matched before their shorter prefixes (`YY`, `MM`).
  return fmt.replace(/YYYY|YY|MMM|MM|DD|HH|mm|ss/g, (tok) => {
    switch (tok) {
      case 'YYYY': return String(when.getFullYear());
      case 'YY':   return String(when.getFullYear()).slice(-2);
      case 'MMM':  return SHORT_MONTHS[when.getMonth()];
      case 'MM':   return pad2(when.getMonth() + 1);
      case 'DD':   return pad2(when.getDate());
      case 'HH':   return pad2(when.getHours());
      case 'mm':   return pad2(when.getMinutes());
      case 'ss':   return pad2(when.getSeconds());
      default:     return tok;
    }
  });
}

/**
 * Substitute variables in `template`. Returns the resolved content,
 * the cursor offset (if any), and a `cancelled` flag if the user
 * dismissed an interactive prompt.
 *
 * Implementation note: a regex `.replace` doesn't fit because
 * `{{prompt:…}}` substitution is async. We walk the template once,
 * emitting resolved chunks into an output array — that also gives us
 * a natural place to capture the `{{cursor}}` offset (the length of
 * the joined output at the moment we encounter the marker).
 */
export async function substituteTemplate(
  template: string,
  ctx: SubstitutionContext,
): Promise<SubstitutionResult> {
  const now = ctx.now ?? new Date();
  const out: string[] = [];
  let cursorOffset: number | null = null;
  let cancelled = false;

  let i = 0;
  while (i < template.length) {
    // Escape: `\{{` emits a literal `{{` and skips the rest of the
    // placeholder machinery.
    if (template[i] === '\\' && template.startsWith('{{', i + 1)) {
      out.push('{{');
      i += 3;
      continue;
    }
    if (template.startsWith('{{', i)) {
      const close = template.indexOf('}}', i + 2);
      if (close < 0) {
        // No closing braces — emit the rest verbatim and stop scanning
        // placeholders so we don't loop forever on a malformed file.
        out.push(template.slice(i));
        break;
      }
      const expr = template.slice(i + 2, close).trim();
      const resolved = await resolvePlaceholder(expr, ctx, now);
      if (resolved.kind === 'cursor') {
        cursorOffset ??= out.join('').length;
      } else if (resolved.kind === 'cancelled') {
        cancelled = true;
        // Emit nothing for the cancelled prompt and stop — the caller
        // discards the partial content anyway. Falling through to
        // emit `{{prompt:…}}` literally would surprise both author
        // and reader.
        i = close + 2;
        out.push(template.slice(i));
        break;
      } else {
        out.push(resolved.text);
      }
      i = close + 2;
      continue;
    }
    out.push(template[i]);
    i++;
  }

  return { content: out.join(''), cursorOffset, cancelled };
}

type PlaceholderResolution =
  | { kind: 'text'; text: string }
  | { kind: 'cursor' }
  | { kind: 'cancelled' };

async function resolvePlaceholder(
  expr: string,
  ctx: SubstitutionContext,
  now: Date,
): Promise<PlaceholderResolution> {
  if (expr === 'title') return { kind: 'text', text: ctx.title };
  if (expr === 'cursor') return { kind: 'cursor' };
  if (expr === 'date') return { kind: 'text', text: formatDateTime('YYYY-MM-DD', now) };
  if (expr === 'time') return { kind: 'text', text: formatDateTime('HH:mm', now) };
  if (expr.startsWith('date:')) {
    return { kind: 'text', text: formatDateTime(expr.slice(5), now) };
  }
  if (expr.startsWith('time:')) {
    return { kind: 'text', text: formatDateTime(expr.slice(5), now) };
  }
  if (expr.startsWith('prompt:')) {
    const label = expr.slice(7).trim() || 'Value';
    if (!ctx.prompt) {
      // No prompt resolver was supplied — fall back to emitting the
      // label so the template author at least sees what was missing
      // rather than getting a silently-stripped placeholder.
      return { kind: 'text', text: `{{${label}}}` };
    }
    const answer = await ctx.prompt(label);
    if (answer === null) return { kind: 'cancelled' };
    return { kind: 'text', text: answer };
  }
  // Unknown placeholder — preserve verbatim so the user can see what
  // didn't resolve rather than ending up with a confusing gap.
  return { kind: 'text', text: `{{${expr}}}` };
}
