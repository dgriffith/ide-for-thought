/**
 * Pure planner for Decompose Note (#178). Takes an (edited) LLM proposal
 * plus the source note and produces the list of files to write. Shape
 * matches `planSplitByHeading` \u2014 one source-rewrite + N new children
 * under a subfolder.
 *
 * The proposal itself comes from the LLM and may have been user-edited
 * in the preview dialog; the planner is agnostic about provenance.
 */

import {
  sanitizeFilename,
  resolveDestinationFolder,
  renderFilenamePrefix,
  normalizeHeadingLevels,
  renderLinkBack,
  renderExtractedBody,
} from './extract';
import type { RefactorSettings } from './settings';
import { DEFAULT_REFACTOR_SETTINGS } from './settings';
import type { DecomposeProposal, DecomposeChildProposal } from '../../../shared/refactor/decompose';

export interface DecomposePlan {
  newNotes: Array<{ relativePath: string; content: string }>;
  /** Rewritten source content: original frontmatter + parent narrative + Contents block. */
  updatedSourceContent: string;
}

export interface PlanDecomposeOptions {
  sourceRelativePath: string;
  sourceContent: string;
  proposal: DecomposeProposal;
  /** Subset selector \u2014 same length as proposal.children; `true` means include. */
  include: boolean[];
  today: string;
  settings?: RefactorSettings;
  now?: Date;
}

function extractSourceTitle(relativePath: string, content: string): string {
  const m = content.match(/^#\s+(.+)$/m);
  if (m) return m[1].trim();
  return (relativePath.split('/').pop() ?? relativePath).replace(/\.md$/, '');
}

function basenameWithoutExt(relativePath: string): string {
  const file = relativePath.split('/').pop() ?? relativePath;
  return file.replace(/\.md$/, '');
}

function yamlQuote(s: string): string {
  if (!/[:#]/.test(s)) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}

function buildChildFrontmatter(title: string, sourceRelativePath: string, today: string): string {
  return [
    '---',
    `title: ${yamlQuote(title)}`,
    `created: ${today}`,
    `source: ${sourceRelativePath}`,
    '---',
    '',
  ].join('\n');
}

function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  const m = content.match(/^(---\n[\s\S]*?\n---\n?)/);
  if (!m) return { frontmatter: '', body: content };
  return { frontmatter: m[1], body: content.slice(m[1].length) };
}

/**
 * Collision-safe stem assignment. Matches planSplitByHeading\u2019s behavior
 * so two children titled "Details" don\u2019t overwrite each other.
 */
function assignStems(children: DecomposeChildProposal[], prefix: string): string[] {
  const out: string[] = [];
  const counts = new Map<string, number>();
  for (const c of children) {
    const baseStem = sanitizeFilename(c.title) || 'child';
    const n = counts.get(baseStem) ?? 0;
    counts.set(baseStem, n + 1);
    const stem = n === 0 ? baseStem : `${baseStem}-${n + 1}`;
    out.push(`${prefix}${stem}`);
  }
  return out;
}

export function planDecompose(opts: PlanDecomposeOptions): DecomposePlan {
  const { sourceRelativePath, sourceContent, proposal, include, today } = opts;
  const settings = opts.settings ?? DEFAULT_REFACTOR_SETTINGS;
  const now = opts.now;

  const includedChildren = proposal.children.filter((_, i) => include[i]);
  if (includedChildren.length === 0) {
    return { newNotes: [], updatedSourceContent: sourceContent };
  }

  const { frontmatter } = splitFrontmatter(sourceContent);
  const parentDir = resolveDestinationFolder(sourceRelativePath, settings, now);
  const base = basenameWithoutExt(sourceRelativePath);
  const subfolder = parentDir ? `${parentDir}/${base}` : base;
  const prefix = renderFilenamePrefix(sourceRelativePath, settings, now);
  const stems = assignStems(includedChildren, prefix);
  const sourceTitle = extractSourceTitle(sourceRelativePath, sourceContent);

  const newNotes: Array<{ relativePath: string; content: string }> = [];
  const links: string[] = [];

  for (let i = 0; i < includedChildren.length; i++) {
    const child = includedChildren[i];
    const stem = stems[i];
    const relativePath = `${subfolder}/${stem}.md`;

    const rawBody = normalizeHeadingLevels(child.content.trimEnd(), settings);
    const templateCtx = {
      sourceRelativePath,
      sourceTitle,
      newNoteTitle: child.title,
      now,
    };
    const wrappedBody = renderExtractedBody(rawBody, settings, templateCtx);
    const bodyWithTrailingNewline = wrappedBody + (wrappedBody.endsWith('\n') ? '' : '\n');
    const content = buildChildFrontmatter(child.title, sourceRelativePath, today) + bodyWithTrailingNewline;
    newNotes.push({ relativePath, content });

    if (settings.linkTemplate) {
      links.push(renderLinkBack(relativePath, settings, templateCtx));
    } else if (settings.transcludeByDefault) {
      links.push(`- ![[${subfolder}/${stem}]]`);
    } else {
      links.push(`- [[${subfolder}/${stem}|${child.title}]]`);
    }
  }

  // Build the new source body: LLM's parent narrative + auto-generated Contents list.
  const narrative = proposal.parent.content.trim();
  const indexBlock = ['## Contents', '', ...links, ''].join('\n');
  const newBody = narrative
    ? `${narrative}\n\n${indexBlock}`
    : indexBlock;

  return {
    newNotes,
    updatedSourceContent: frontmatter + newBody,
  };
}
