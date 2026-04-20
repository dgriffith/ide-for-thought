import { getTool } from '../../shared/tools/registry';
import { complete } from '../llm/index';
import { getSettings } from '../llm/settings';
import type { ToolExecutionRequest, ToolExecutionResult, ThinkingToolDef, LLMSettings, ConversationToolPayload } from '../../shared/tools/types';

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
  if (tool.outputMode === 'openConversation') {
    throw new Error(`Tool ${request.toolId} is conversational — use prepareConversationTool instead of executeTool.`);
  }

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

/**
 * Pure payload builder. Extracted so tests don't need to mock `getSettings()`.
 * `prepareConversationTool` is the real entry point that looks up the tool
 * and threads settings in.
 */
export function buildConversationPayload(
  tool: ThinkingToolDef,
  settings: Pick<LLMSettings, 'toolModelOverrides'>,
  request: Pick<ToolExecutionRequest, 'context'> & { modelOverride?: string },
): ConversationToolPayload {
  if (tool.outputMode !== 'openConversation') {
    throw new Error(`Tool ${tool.id} is not conversational (outputMode=${tool.outputMode}).`);
  }
  if (!tool.buildSystemPrompt) {
    throw new Error(`Conversational tool ${tool.id} must define buildSystemPrompt.`);
  }

  const model = resolveToolModel(tool, settings, request.modelOverride);

  return {
    toolId: tool.id,
    systemPrompt: tool.buildSystemPrompt(request.context),
    firstMessage: tool.buildFirstMessage ? tool.buildFirstMessage(request.context) : '',
    ...(model ? { model } : {}),
    webEnabled: tool.web?.defaultEnabled ?? false,
  };
}

/**
 * Resolves everything needed to launch a conversation for a tool with
 * `outputMode: 'openConversation'`: the pinned system prompt, the optional
 * auto-first-message, the effective model, and the web hint. Does not open
 * the conversation itself — that's the renderer's job (create, pin, show).
 */
export async function prepareConversationTool(
  request: ToolExecutionRequest & { modelOverride?: string },
): Promise<ConversationToolPayload> {
  const tool = getTool(request.toolId);
  if (!tool) throw new Error(`Unknown tool: ${request.toolId}`);
  const settings = await getSettings();
  return buildConversationPayload(tool, settings, request);
}
