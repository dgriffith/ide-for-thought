import { getTool } from '../../shared/tools/registry';
import { complete } from '../llm/index';
import type { ToolExecutionRequest, ToolExecutionResult } from '../../shared/tools/types';

// Ensure all tool definitions are registered
import '../../shared/tools/definitions/index';

export async function executeTool(
  request: ToolExecutionRequest,
  onChunk?: (text: string) => void,
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  const tool = getTool(request.toolId);
  if (!tool) throw new Error(`Unknown tool: ${request.toolId}`);

  const prompt = tool.buildPrompt(request.context);

  const output = await complete(prompt, onChunk ? { onChunk, signal } : undefined);

  const noteTitle = request.context.fullNoteTitle ?? 'Untitled';
  return {
    toolId: request.toolId,
    output,
    suggestedTitle: `${tool.name}: ${noteTitle}`,
    suggestedFilename: `${tool.outputNotePrefix ?? tool.id.replace('.', '-')}-${noteTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')}.md`,
  };
}
