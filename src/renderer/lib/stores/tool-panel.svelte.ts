import type { ThinkingToolInfo, ToolContext, ToolExecutionResult } from '../../../shared/tools/types';

export type PanelState = 'hidden' | 'configure' | 'running' | 'review';

let activeTool = $state<ThinkingToolInfo | null>(null);
let panelState = $state<PanelState>('hidden');
let streamedOutput = $state('');
let context = $state<ToolContext>({});
let result = $state<ToolExecutionResult | null>(null);
let error = $state<string | null>(null);

export function getToolPanelStore() {
  function open(tool: ThinkingToolInfo, ctx: ToolContext) {
    activeTool = tool;
    context = ctx;
    streamedOutput = '';
    result = null;
    error = null;
    panelState = tool.parameters && tool.parameters.length > 0 ? 'configure' : 'running';
  }

  function startRunning(parameterValues?: Record<string, string>) {
    if (parameterValues) {
      context = { ...context, parameterValues };
    }
    streamedOutput = '';
    result = null;
    error = null;
    panelState = 'running';
  }

  function appendChunk(chunk: string) {
    streamedOutput += chunk;
  }

  function complete(execResult: ToolExecutionResult) {
    result = execResult;
    panelState = 'review';
  }

  function fail(message: string) {
    error = message;
    panelState = 'review';
  }

  function close() {
    activeTool = null;
    panelState = 'hidden';
    streamedOutput = '';
    result = null;
    error = null;
    context = {};
  }

  return {
    get activeTool() { return activeTool; },
    get panelState() { return panelState; },
    get streamedOutput() { return streamedOutput; },
    get context() { return context; },
    get result() { return result; },
    get error() { return error; },
    open,
    startRunning,
    appendChunk,
    complete,
    fail,
    close,
  };
}
