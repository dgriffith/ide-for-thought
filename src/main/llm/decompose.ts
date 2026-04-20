import * as notebaseFs from '../notebase/fs';
import { parseMarkdown } from '../graph/parser';
import { complete } from './index';
import { getSettings } from './settings';
import {
  buildDecomposePrompt,
  parseDecomposeResponse,
  type DecomposeProposal,
} from '../../shared/refactor/decompose';

export interface DecomposeHints {
  normalizeHeadings?: boolean;
  transcludeByDefault?: boolean;
}

export interface SuggestDecompositionResult {
  proposal: DecomposeProposal | null;
  /** Short diagnostic when the LLM response couldn\u2019t be parsed. */
  error?: string;
}

/**
 * Runs the Decompose Note LLM call. Uses the user\u2019s global default
 * model. The ticket specifies Opus-preferred for quality, but we
 * consistently defer per-tool overrides for direct-mutation flows
 * (same story as Auto-tag / Auto-link) until ThinkingTool registration
 * is extended to cover them.
 */
export async function suggestDecomposition(
  rootPath: string,
  activeRelPath: string,
  hints: DecomposeHints = {},
): Promise<SuggestDecompositionResult> {
  const content = await notebaseFs.readFile(rootPath, activeRelPath);
  const parsed = parseMarkdown(content);
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const title = parsed.title
    || activeRelPath.replace(/\.md$/i, '').split('/').pop()
    || activeRelPath;

  const prompt = buildDecomposePrompt({
    sourceTitle: title,
    sourceBody: body,
    hints,
  });

  const { model } = await getSettings();
  const raw = await complete(prompt, { model });
  return parseDecomposeResponse(raw);
}
