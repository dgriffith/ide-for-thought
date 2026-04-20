import fs from 'node:fs/promises';
import path from 'node:path';
import * as notebaseFs from '../notebase/fs';
import { parseMarkdown } from '../graph/parser';
import { complete } from './index';
import { getSettings } from './settings';
import {
  buildAutoLinkToPrompt,
  parseAutoLinkResponse,
  applyLinkInsertions,
  extractSummary,
  type AutoLinkSuggestion,
  type CandidateNote,
} from '../../shared/refactor/auto-link';

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.minerva', '.obsidian']);
const MD_EXT = '.md';

/** Hard cap so a huge thoughtbase doesn\u2019t blow the prompt budget. */
const MAX_CANDIDATES = 150;

/**
 * Walks the notebase and returns a compact list of candidate target notes.
 * The active note is excluded. Candidates are title + short summary, built
 * from the note\u2019s `dc:description` frontmatter when present, otherwise its
 * first non-empty paragraph of body.
 */
export async function listAutoLinkCandidates(
  rootPath: string,
  excludeRelPath: string,
): Promise<CandidateNote[]> {
  const notes: string[] = [];
  await walk(rootPath, '', notes);

  const candidates: CandidateNote[] = [];
  for (const rel of notes) {
    if (rel === excludeRelPath) continue;
    if (candidates.length >= MAX_CANDIDATES) break;
    try {
      const raw = await notebaseFs.readFile(rootPath, rel);
      const parsed = parseMarkdown(raw);
      const title = parsed.title || rel.replace(/\.md$/i, '').split('/').pop() || rel;
      const description =
        typeof parsed.frontmatter.description === 'string'
          ? parsed.frontmatter.description
          : undefined;
      const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, '');
      candidates.push({
        relativePath: rel,
        title,
        summary: extractSummary(body, description),
      });
    } catch { /* unreadable note — skip */ }
  }
  return candidates;
}

async function walk(rootPath: string, relDir: string, out: string[]): Promise<void> {
  const absDir = path.join(rootPath, relDir);
  let entries;
  try {
    entries = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (IGNORED_DIRS.has(entry.name)) continue;
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await walk(rootPath, rel, out);
    } else if (entry.name.toLowerCase().endsWith(MD_EXT)) {
      out.push(rel);
    }
  }
}

export interface AutoLinkSuggestResult {
  suggestions: AutoLinkSuggestion[];
  candidateCount: number;
}

/**
 * "Link to" mode: asks the LLM where in the active note a wiki-link to
 * one of the thoughtbase\u2019s other notes would fit. Returns suggestions
 * whose `anchorText` is guaranteed to appear in the active note at an
 * unlinked position (validated on the renderer\u2019s side when applying).
 */
export async function suggestLinksTo(
  rootPath: string,
  activeRelPath: string,
): Promise<AutoLinkSuggestResult> {
  const activeContent = await notebaseFs.readFile(rootPath, activeRelPath);
  const parsed = parseMarkdown(activeContent);
  const activeBody = activeContent.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const activeTitle = parsed.title || activeRelPath.replace(/\.md$/i, '').split('/').pop() || activeRelPath;

  const candidates = await listAutoLinkCandidates(rootPath, activeRelPath);
  if (candidates.length === 0) {
    return { suggestions: [], candidateCount: 0 };
  }

  const prompt = buildAutoLinkToPrompt({
    activeTitle,
    activeBody,
    candidates,
  });

  const { model } = await getSettings();
  const raw = await complete(prompt, { model });
  const validTargets = new Set(candidates.map((c) => c.relativePath));
  const suggestions = parseAutoLinkResponse(raw, validTargets);

  // Keep only suggestions whose anchor text actually appears in the active
  // body — otherwise the apply step would silently drop them anyway.
  const filtered = suggestions.filter((s) => activeBody.includes(s.anchorText));
  return { suggestions: filtered, candidateCount: candidates.length };
}

/** Rewrites the active note with accepted suggestions. Returns the new content + bookkeeping. */
export async function applyAutoLinkToSuggestions(
  rootPath: string,
  activeRelPath: string,
  accepted: AutoLinkSuggestion[],
): Promise<{ content: string; applied: AutoLinkSuggestion[]; skipped: AutoLinkSuggestion[] }> {
  const current = await notebaseFs.readFile(rootPath, activeRelPath);
  return applyLinkInsertions(current, accepted);
}
