import * as notebaseFs from '../notebase/fs';
import { parseMarkdown } from '../graph/parser';
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';
import { complete } from './index';
import { getSettings } from './settings';
import { proposeWrite, approveProposal } from './approval';
import {
  buildAutoTagPrompt,
  parseAutoTagResponse,
  mergeTagsIntoContent,
} from '../../shared/refactor/auto-tag';

export interface AutoTagPlan {
  /** Tags that would be newly added to the note\u2019s frontmatter. Empty when there\u2019s nothing to do. */
  added: string[];
  /** Rewritten note content when `added` is non-empty; `null` for the silent no-op case. */
  content: string | null;
}

/**
 * Runs Auto-tag against a single note: asks the LLM for relevant tags
 * (seeded with the thoughtbase\u2019s existing vocabulary) and returns the
 * merged frontmatter as a new content string. Does **not** write \u2014 the
 * caller is responsible for persisting + reindexing so the write flows
 * through the same broadcast path as a user save (#174).
 */
export async function runAutoTag(
  rootPath: string,
  relativePath: string,
): Promise<AutoTagPlan> {
  return graph.withLLMContext(async () => {
    const content = await notebaseFs.readFile(rootPath, relativePath);
    const parsed = parseMarkdown(content);

    const thoughtbaseTags = graph.listTags(projectContext(rootPath)).map((t) => t.tag);
    const existingNoteTags: string[] = [];
    if (Array.isArray(parsed.frontmatter.tags)) {
      for (const t of parsed.frontmatter.tags) {
        if (typeof t === 'string') existingNoteTags.push(t);
      }
    }

    const noteBody = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
    const prompt = buildAutoTagPrompt({
      noteTitle: parsed.title ?? '',
      noteBody,
      existingNoteTags,
      thoughtbaseTags,
    });

    const { model } = await getSettings();
    const raw = await complete(prompt, { model });
    const suggested = parseAutoTagResponse(raw);
    if (suggested.length === 0) return { added: [], content: null };

    const { content: next, addedTags } = mergeTagsIntoContent(content, suggested);
    if (addedTags.length === 0) return { added: [], content: null };

    return { added: addedTags, content: next };
  });
}

export interface AutoTagApplyResult {
  /** Tags actually merged into the note (may be a subset of what was accepted —
   *  a tag the note already has is a no-op). Empty when nothing changed. */
  applied: string[];
  /** Path overwritten in place, for the caller's NOTEBASE_REWRITTEN broadcast.
   *  Empty when nothing changed. */
  rewrittenPaths: string[];
}

/**
 * Apply the tags the user accepted from the Auto-tag review (#940). Unlike the
 * old one-shot path, this routes the frontmatter change through the approval
 * engine's `note-rewrite` payload (#936) rather than writing directly — so the
 * Trust Principle holds (there's a `thought:Proposal` audit record) and the
 * write is unified with every other LLM-originated note mutation.
 *
 * Recomputes the merge against the note's CURRENT on-disk content (not a
 * snapshot from suggest time) so edits made between suggest and apply aren't
 * clobbered. Electron-free: returns the rewritten path for the IPC layer to
 * broadcast, mirroring the approval engine's own seam.
 */
export async function applyAutoTag(
  rootPath: string,
  relativePath: string,
  acceptedTags: string[],
): Promise<AutoTagApplyResult> {
  // Armed with the trust guard (#944): this is LLM-originated, so any graph
  // write here that doesn't go through the approval engine trips the guard.
  return graph.withLLMContext(async () => {
    const content = await notebaseFs.readFile(rootPath, relativePath);
    const { content: next, addedTags } = mergeTagsIntoContent(content, acceptedTags);
    if (addedTags.length === 0) return { applied: [], rewrittenPaths: [] };

    const ctx = projectContext(rootPath);
    const proposal = await proposeWrite(ctx, {
      operationType: 'note_rewrite',
      payloads: [{ kind: 'note-rewrite', path: relativePath, content: next }],
      note: `Auto-tag: add ${addedTags.length} tag${addedTags.length === 1 ? '' : 's'} to ${relativePath}`,
      proposedBy: 'llm:auto-tag',
    });
    // note_rewrite is requires_approval, so proposeWrite returns a pending
    // proposal; the user already reviewed the tags on the card, so approve now.
    let rewrittenPaths: string[] = [];
    if (proposal) {
      const result = await approveProposal(ctx, proposal.uri);
      rewrittenPaths = result.rewrittenPaths;
    }
    return { applied: addedTags, rewrittenPaths };
  });
}
