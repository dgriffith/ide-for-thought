/**
 * Live-buffer footnote scanner (#462).
 *
 * Walks the editor text and pulls out:
 *   - Definitions: `[^name]: body...` line-anchored at column 0,
 *     with continuation lines that are either indented whitespace
 *     OR a blank line followed by another indented line. Standard
 *     Pandoc/CommonMark-extension footnote syntax.
 *   - References: `[^name]` inline, NOT followed by `:`.
 *
 * Backslash-escaped `\[^foo]` is ignored. Code fences and inline
 * code are skipped — a `[^foo]` inside `` ` `` is not a real ref.
 *
 * Output shape is shared by the sidebar panel (#462) and the planned
 * inline hover-preview (#484); both want the same definition map.
 */

export interface FootnoteDefinition {
  /** Label inside `[^…]:`, e.g. `foo` for `[^foo]:` */
  label: string;
  /** Body text, joined across continuation lines, leading indent stripped */
  body: string;
  /** 1-based line of the `[^name]:` opener */
  defLine: number;
  /** 0-based column of `[` on the opener line */
  defColumn: number;
}

export interface FootnoteReference {
  label: string;
  /** 1-based line where the `[^…]` reference appears */
  line: number;
  /** 0-based column of `[` */
  column: number;
}

export interface FootnoteScan {
  definitions: FootnoteDefinition[];
  references: FootnoteReference[];
  /** Definitions that no in-text reference points at. */
  orphanDefinitions: FootnoteDefinition[];
  /** References whose label has no matching definition. */
  missingReferences: FootnoteReference[];
}

const DEF_RE = /^\[\^([\w-]+)\]:\s?(.*)$/;
const REF_RE = /(?<!\\)\[\^([\w-]+)\](?!:)/g;

/**
 * Scan `text` and return every footnote definition / reference plus
 * the diagnostic mismatch sets. O(n) over input length; callers
 * should still debounce for keystroke-frequency calls.
 */
export function scanFootnotes(text: string): FootnoteScan {
  const lines = text.split('\n');
  const definitions = collectDefinitions(lines);
  const references = collectReferences(lines);

  const defLabels = new Set(definitions.map((d) => d.label));
  const refLabels = new Set(references.map((r) => r.label));

  return {
    definitions,
    references,
    orphanDefinitions: definitions.filter((d) => !refLabels.has(d.label)),
    missingReferences: references.filter((r) => !defLabels.has(r.label)),
  };
}

function collectDefinitions(lines: string[]): FootnoteDefinition[] {
  const out: FootnoteDefinition[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(DEF_RE);
    if (!m) continue;
    const label = m[1];
    const bodyParts: string[] = [m[2]];
    // Continuation: subsequent lines that are indented OR are blank
    // followed eventually by an indented line. Pandoc's "lazy
    // continuation" — but a non-indented non-blank line ends the def.
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      if (/^\s+\S/.test(next)) {
        bodyParts.push(next.replace(/^\s+/, ''));
        j++;
        continue;
      }
      if (next === '' || /^\s*$/.test(next)) {
        // Peek ahead — only treat the blank as a continuation gap if
        // the next non-blank line is indented (still part of the def).
        let k = j + 1;
        while (k < lines.length && /^\s*$/.test(lines[k])) k++;
        if (k < lines.length && /^\s+\S/.test(lines[k])) {
          bodyParts.push('');
          j++;
          continue;
        }
      }
      break;
    }
    out.push({
      label,
      body: bodyParts.join(' ').trim(),
      defLine: i + 1,
      defColumn: 0,
    });
    i = j - 1;
  }
  return out;
}

function collectReferences(lines: string[]): FootnoteReference[] {
  const out: FootnoteReference[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    // Skip definition lines themselves — `[^foo]:` matches REF_RE
    // unless we explicitly skip.
    if (DEF_RE.test(line)) continue;
    // Drop inline-code spans before scanning; a `[^foo]` inside
    // backticks is text, not a reference.
    const stripped = stripInlineCode(line);
    REF_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = REF_RE.exec(stripped)) !== null) {
      out.push({ label: m[1], line: i + 1, column: m.index });
    }
  }
  return out;
}

function stripInlineCode(line: string): string {
  // Replace `…` runs with same-length spaces so column indices stay
  // aligned with the original source.
  return line.replace(/`[^`]*`/g, (s) => ' '.repeat(s.length));
}
