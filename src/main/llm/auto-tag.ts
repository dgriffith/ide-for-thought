import * as notebaseFs from '../notebase/fs';
import { parseMarkdown } from '../graph/parser';
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';
import { complete } from './index';
import { getSettings } from './settings';
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
  graph.enterLLMContext();
  try {
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
  } finally {
    graph.exitLLMContext();
  }
}
