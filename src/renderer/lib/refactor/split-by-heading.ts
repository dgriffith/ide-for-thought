/**
 * Pure planner for "Split by heading" (#122). Shatters one long note
 * into one new note per heading at the chosen level.
 */

import {
  sanitizeFilename,
  resolveDestinationFolder,
  renderFilenamePrefix,
  normalizeHeadingLevels,
} from './extract';
import type { RefactorSettings } from './settings';
import { DEFAULT_REFACTOR_SETTINGS } from './settings';

export interface SplitByHeadingPlan {
  /** Files to write (order doesn't matter; caller writes each). */
  newNotes: Array<{ relativePath: string; content: string }>;
  /** Rewritten source content: preamble + `## Contents` index. */
  updatedSourceContent: string;
}

export interface PlanSplitByHeadingOptions {
  sourceRelativePath: string;
  sourceContent: string;
  /** Heading level to split on (1, 2, or 3). */
  level: 1 | 2 | 3;
  today: string;
  settings?: RefactorSettings;
  now?: Date;
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

function basenameWithoutExt(relativePath: string): string {
  const file = relativePath.split('/').pop() ?? relativePath;
  return file.replace(/\.md$/, '');
}

function yamlQuote(s: string): string {
  if (!/[:#]/.test(s)) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}

function buildFrontmatter(title: string, sourceRelativePath: string, today: string): string {
  return [
    '---',
    `title: ${yamlQuote(title)}`,
    `created: ${today}`,
    `source: ${sourceRelativePath}`,
    '---',
    '',
  ].join('\n');
}

function splitFrontmatter(content: string): { frontmatter: string; body: string; bodyOffset: number } {
  const m = content.match(/^(---\n[\s\S]*?\n---\n?)/);
  if (!m) return { frontmatter: '', body: content, bodyOffset: 0 };
  return { frontmatter: m[1], body: content.slice(m[1].length), bodyOffset: m[1].length };
}

/** Find every line that looks like an ATX heading of the given level, outside fenced code blocks. */
function findHeadings(body: string, level: number): Array<{ lineStart: number; text: string; fullLine: string }> {
  const out: Array<{ lineStart: number; text: string; fullLine: string }> = [];
  let offset = 0;
  let inFence = false;
  for (const line of body.split('\n')) {
    if (/^```/.test(line)) inFence = !inFence;
    if (!inFence) {
      const m = line.match(HEADING_RE);
      if (m && m[1].length === level) {
        out.push({ lineStart: offset, text: m[2].trim(), fullLine: line });
      }
    }
    offset += line.length + 1; // account for the \n
  }
  return out;
}

/**
 * Assign a unique filename stem per heading, suffixing (-2, -3, …) on
 * collisions so two `## Changes` sections don't overwrite each other.
 */
function assignStems(headings: Array<{ text: string }>, prefix = ''): string[] {
  const out: string[] = [];
  const counts = new Map<string, number>();
  for (const h of headings) {
    const baseStem = sanitizeFilename(h.text) || 'section';
    const n = counts.get(baseStem) ?? 0;
    counts.set(baseStem, n + 1);
    const stem = n === 0 ? baseStem : `${baseStem}-${n + 1}`;
    out.push(`${prefix}${stem}`);
  }
  return out;
}

export function planSplitByHeading(opts: PlanSplitByHeadingOptions): SplitByHeadingPlan {
  const { sourceRelativePath, sourceContent, level, today } = opts;
  const settings = opts.settings ?? DEFAULT_REFACTOR_SETTINGS;
  const now = opts.now;

  const { frontmatter, body } = splitFrontmatter(sourceContent);
  const headings = findHeadings(body, level);
  if (headings.length === 0) {
    return { newNotes: [], updatedSourceContent: sourceContent };
  }

  // Slice body into [preamble, section_1, section_2, …]. Each section begins
  // at its heading's line; the preamble is everything before the first.
  const preamble = body.slice(0, headings[0].lineStart);
  const sections: string[] = [];
  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].lineStart;
    const end = i + 1 < headings.length ? headings[i + 1].lineStart : body.length;
    sections.push(body.slice(start, end));
  }

  const parentDir = resolveDestinationFolder(sourceRelativePath, settings, now);
  const base = basenameWithoutExt(sourceRelativePath);
  const subfolder = parentDir ? `${parentDir}/${base}` : base;
  const prefix = renderFilenamePrefix(sourceRelativePath, settings, now);
  const stems = assignStems(headings, prefix);

  const newNotes: Array<{ relativePath: string; content: string }> = [];
  const links: string[] = [];

  for (let i = 0; i < headings.length; i++) {
    const stem = stems[i];
    const relativePath = `${subfolder}/${stem}.md`;
    const title = headings[i].text;
    const sectionBody = normalizeHeadingLevels(sections[i].trimEnd(), settings) + '\n';
    const content = buildFrontmatter(title, sourceRelativePath, today) + sectionBody;
    newNotes.push({ relativePath, content });
    links.push(`- [[${subfolder}/${stem}|${title}]]`);
  }

  // Rebuild the source: keep the frontmatter, keep any preamble prose, then
  // replace the shattered sections with a `## Contents` index.
  const preambleTrimmed = preamble.replace(/\s+$/, '');
  const indexBlock = ['## Contents', '', ...links, ''].join('\n');
  const newBody =
    (preambleTrimmed ? `${preambleTrimmed}\n\n` : '') +
    indexBlock;

  return {
    newNotes,
    updatedSourceContent: frontmatter + newBody,
  };
}
