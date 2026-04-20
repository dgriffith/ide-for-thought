import { getTool } from '../../shared/tools/registry';
import { complete } from '../llm/index';
import { getSettings } from '../llm/settings';
import type { ToolExecutionRequest, ToolExecutionResult, ThinkingToolDef, LLMSettings } from '../../shared/tools/types';

// Ensure all tool definitions are registered
import '../../shared/tools/definitions/index';

/**
 * Resolution order for which model a tool invocation runs on:
 *   1. Explicit per-invocation override (not wired from any UI yet — reserved
 *      for a future ad-hoc picker).
 *   2. User's per-tool override from LLMSettings.toolModelOverrides.
 *   3. Tool author's preferredModel on the definition.
 *   4. Global default (LLMSettings.model). Passing undefined here lets
 *      complete() fall back to it.
 */
export function resolveToolModel(
  tool: Pick<ThinkingToolDef, 'id' | 'preferredModel'>,
  settings: Pick<LLMSettings, 'toolModelOverrides'>,
  perInvocation?: string,
): string | undefined {
  if (perInvocation) return perInvocation;
  const userOverride = settings.toolModelOverrides?.[tool.id];
  if (userOverride) return userOverride;
  return tool.preferredModel;
}

export async function executeTool(
  request: ToolExecutionRequest & { modelOverride?: string },
  onChunk?: (text: string) => void,
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  const tool = getTool(request.toolId);
  if (!tool) throw new Error(`Unknown tool: ${request.toolId}`);

  const prompt = tool.buildPrompt(request.context);
  const settings = await getSettings();
  const model = resolveToolModel(tool, settings, request.modelOverride);

  const output = await complete(prompt, {
    ...(onChunk ? { callbacks: { onChunk, signal } } : {}),
    ...(model ? { model } : {}),
  });

  const noteTitle = request.context.fullNoteTitle ?? 'Untitled';
  return {
    toolId: request.toolId,
    output,
    suggestedTitle: `${tool.name}: ${noteTitle}`,
    suggestedFilename: `${tool.outputNotePrefix ?? tool.id.replace('.', '-')}-${noteTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')}.md`,
  };
}
