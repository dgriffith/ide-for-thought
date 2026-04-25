import fs from 'node:fs/promises';
import path from 'node:path';
import * as notebaseFs from '../notebase/fs';
import { parseMarkdown } from '../graph/parser';
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';
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
import {
  buildAutoLinkInboundPrompt,
  parseInboundResponse,
  snippetAround,
  type AutoLinkInboundSuggestion,
  type InboundCandidate,
} from '../../shared/refactor/auto-link-inbound';

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

// ── Inbound mode (#175 follow-up) ─────────────────────────────────────────

/** Hard cap on candidate source notes for inbound mode. Full-content passes per note get expensive fast. */
const INBOUND_CANDIDATE_CAP = 15;

/**
 * Picks candidate source notes for inbound auto-link:
 *  1. Notes that share at least one tag with the active note (ranked by shared-tag count).
 *  2. Most-recently-modified notes as fill-in when tag matches are thin.
 * Caps at INBOUND_CANDIDATE_CAP.
 */
export async function pickInboundCandidates(
  rootPath: string,
  activeRelPath: string,
): Promise<string[]> {
  // Collect the active note's tags (body #tags + frontmatter tags).
  const activeContent = await notebaseFs.readFile(rootPath, activeRelPath);
  const parsed = parseMarkdown(activeContent);
  const tags = new Set<string>(parsed.tags);
  if (Array.isArray(parsed.frontmatter.tags)) {
    for (const t of parsed.frontmatter.tags) {
      if (typeof t === 'string') tags.add(t);
    }
  }

  const scored = new Map<string, number>();
  for (const tag of tags) {
    for (const note of graph.notesByTag(projectContext(rootPath), tag)) {
      if (note.relativePath === activeRelPath) continue;
      scored.set(note.relativePath, (scored.get(note.relativePath) ?? 0) + 1);
    }
  }

  // Fill the rest with recent-by-mtime when tag overlap didn't fill the cap.
  if (scored.size < INBOUND_CANDIDATE_CAP) {
    const recent = await listRecentNotes(rootPath, INBOUND_CANDIDATE_CAP * 2);
    for (const rel of recent) {
      if (rel === activeRelPath) continue;
      if (scored.has(rel)) continue;
      scored.set(rel, 0);
      if (scored.size >= INBOUND_CANDIDATE_CAP) break;
    }
  }

  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, INBOUND_CANDIDATE_CAP)
    .map(([rel]) => rel);
}

async function listRecentNotes(rootPath: string, limit: number): Promise<string[]> {
  const notes: string[] = [];
  await walk(rootPath, '', notes);
  const withMtime = await Promise.all(
    notes.map(async (rel) => {
      try {
        const stat = await fs.stat(path.join(rootPath, rel));
        return { rel, mtimeMs: stat.mtimeMs };
      } catch {
        return { rel, mtimeMs: 0 };
      }
    }),
  );
  return withMtime
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map((e) => e.rel);
}

export interface AutoLinkInboundResult {
  suggestions: AutoLinkInboundSuggestion[];
  candidateCount: number;
}

/**
 * "Link from" / "Auto-link inbound" mode: finds places in *other* notes
 * where a link pointing at the active note would fit. Single-pass v1:
 * picks up to 15 candidate source notes (tag overlap + recency), hands
 * their full content plus the active note's summary to the LLM, and
 * returns anchor-text based suggestions with pre-computed context
 * snippets.
 */
export async function suggestLinksInbound(
  rootPath: string,
  activeRelPath: string,
): Promise<AutoLinkInboundResult> {
  const activeContent = await notebaseFs.readFile(rootPath, activeRelPath);
  const parsedActive = parseMarkdown(activeContent);
  const activeBody = activeContent.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const activeTitle = parsedActive.title
    || activeRelPath.replace(/\.md$/i, '').split('/').pop()
    || activeRelPath;
  const activeDescription =
    typeof parsedActive.frontmatter.description === 'string'
      ? parsedActive.frontmatter.description
      : undefined;
  const activeSummary = extractSummary(activeBody, activeDescription);

  const candidatePaths = await pickInboundCandidates(rootPath, activeRelPath);
  if (candidatePaths.length === 0) {
    return { suggestions: [], candidateCount: 0 };
  }

  const candidates: InboundCandidate[] = [];
  for (const rel of candidatePaths) {
    try {
      const raw = await notebaseFs.readFile(rootPath, rel);
      const p = parseMarkdown(raw);
      const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, '');
      const title = p.title || rel.replace(/\.md$/i, '').split('/').pop() || rel;
      candidates.push({ relativePath: rel, title, body });
    } catch { /* unreadable source — skip */ }
  }

  const prompt = buildAutoLinkInboundPrompt({
    activeTitle,
    activePath: activeRelPath,
    activeSummary,
    candidates,
  });

  const { model } = await getSettings();
  const raw = await complete(prompt, { model });
  const validSources = new Set(candidates.map((c) => c.relativePath));
  const suggestions = parseInboundResponse(raw, validSources);

  // Keep only suggestions whose anchor is a verbatim substring of the source
  // body (LLM paraphrases get dropped), and pre-compute the context snippet.
  const bodies = new Map(candidates.map((c) => [c.relativePath, c.body]));
  const filtered: AutoLinkInboundSuggestion[] = [];
  for (const s of suggestions) {
    const body = bodies.get(s.source);
    if (!body) continue;
    if (!body.includes(s.anchorText)) continue;
    filtered.push({ ...s, contextSnippet: snippetAround(body, s.anchorText) });
  }

  return { suggestions: filtered, candidateCount: candidates.length };
}

export interface ApplyInboundResult {
  applied: AutoLinkInboundSuggestion[];
  skipped: AutoLinkInboundSuggestion[];
  /** Source notes whose content was rewritten (for NOTEBASE_REWRITTEN broadcast). */
  touchedPaths: string[];
  /** Updated content per touched source path. Caller writes these. */
  updatedContents: Map<string, string>;
}

/**
 * Groups accepted suggestions by source note, applies link insertions to
 * each source (linking at the active note), and returns the new contents
 * to persist. The caller is responsible for the write + reindex + broadcast.
 */
export async function applyInboundSuggestions(
  rootPath: string,
  activeRelPath: string,
  accepted: AutoLinkInboundSuggestion[],
): Promise<ApplyInboundResult> {
  const bySource = new Map<string, AutoLinkInboundSuggestion[]>();
  for (const s of accepted) {
    if (!bySource.has(s.source)) bySource.set(s.source, []);
    bySource.get(s.source)!.push(s);
  }

  const applied: AutoLinkInboundSuggestion[] = [];
  const skipped: AutoLinkInboundSuggestion[] = [];
  const touchedPaths: string[] = [];
  const updatedContents = new Map<string, string>();

  for (const [source, items] of bySource) {
    const current = await notebaseFs.readFile(rootPath, source);
    const synthetic: AutoLinkSuggestion[] = items.map((s) => ({
      anchorText: s.anchorText,
      target: activeRelPath,
      rationale: s.rationale,
    }));
    const res = applyLinkInsertions(current, synthetic);
    // Map applied/skipped indices back to the original inbound suggestions.
    const appliedKeys = new Set(res.applied.map((a) => a.anchorText + '\u0001' + a.target));
    for (const item of items) {
      const key = item.anchorText + '\u0001' + activeRelPath;
      if (appliedKeys.has(key)) applied.push(item);
      else skipped.push(item);
    }
    if (res.content !== current) {
      updatedContents.set(source, res.content);
      touchedPaths.push(source);
    }
  }

  return { applied, skipped, touchedPaths, updatedContents };
}
