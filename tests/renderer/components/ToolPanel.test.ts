/**
 * @vitest-environment happy-dom
 *
 * What the thinking-tool panel shows once a run finishes — and, the reason this
 * file exists, once a run *fails* (#1809).
 *
 * The panel streams the model's output live, then swaps to a review state. The
 * review state used to render the error INSTEAD of the output, so text the user
 * had just watched arrive vanished the moment the failure landed. #1804 made
 * the conversation transcript keep its partial reply; this surface kept the
 * old behaviour, and it is the one reachable straight from the Learning /
 * Research / Analysis menus.
 *
 * Drives the real tool-panel store (a runes singleton) rather than a stub, so
 * these assert the actual streamed-buffer → rendered-output path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import type { ThinkingToolInfo } from '../../../src/shared/tools/types';

vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: {
    tools: { execute: vi.fn(), cancel: vi.fn().mockResolvedValue(undefined) },
    notebase: { readFile: vi.fn() },
  },
}));
vi.mock('../../../src/renderer/lib/tools/output', () => ({ handleToolOutput: vi.fn() }));

import ToolPanel from '../../../src/renderer/lib/components/ToolPanel.svelte';
import { getToolPanelStore } from '../../../src/renderer/lib/stores/tool-panel.svelte';

const panel = getToolPanelStore();

const TOOL = {
  id: 'analysis.antithesize',
  name: 'Antithesize',
  description: 'Argue the other side',
  context: [],
} as unknown as ThinkingToolInfo;

beforeEach(() => {
  cleanup();
  panel.close();
});

/** Put the panel where a half-finished run leaves it. */
function streamSomeOutput(text = 'The strongest counter-argument is that') {
  panel.open(TOOL, {});
  panel.startRunning();
  panel.appendChunk(text);
}

describe('ToolPanel review state', () => {
  it('keeps the streamed output on screen when the run fails', () => {
    streamSomeOutput();
    panel.fail('Anthropic is overloaded right now. This is temporary and not a problem with your setup.');
    render(ToolPanel);

    // Both, not either: the partial output AND why it stopped.
    expect(screen.getByText(/The strongest counter-argument is that/)).toBeTruthy();
    expect(screen.getByText(/Anthropic is overloaded right now/)).toBeTruthy();
  });

  it('offers Copy for a partial, but not Save as Note — there is no result to file', () => {
    streamSomeOutput();
    panel.fail('Couldn\'t reach Anthropic. Check your internet connection.');
    render(ToolPanel);

    expect(screen.getByText('Copy')).toBeTruthy();
    expect(screen.queryByText('Save as Note')).toBeNull();
    expect(screen.getByText('Close')).toBeTruthy();
  });

  it('keeps what a cancelled run had already written', () => {
    // Same principle as a stopped conversation turn: pressing Cancel stops the
    // work, it doesn't retract the words.
    streamSomeOutput('Half an essay');
    panel.fail('Cancelled');
    render(ToolPanel);

    expect(screen.getByText(/Half an essay/)).toBeTruthy();
  });

  it('shows only the error when a run failed before producing anything', () => {
    // e.g. the pre-run "needs a text selection" guard — nothing streamed, so
    // there is no empty output box to render.
    panel.open(TOOL, {});
    panel.fail('Antithesize needs a text selection. Highlight some text in the editor and try again.');
    render(ToolPanel);

    expect(screen.getByText(/needs a text selection/)).toBeTruthy();
    expect(screen.queryByText('Copy')).toBeNull();
  });

  it('shows the finished result with the full action set on success', () => {
    streamSomeOutput();
    panel.complete({ output: 'The finished essay', toolId: TOOL.id });
    render(ToolPanel);

    expect(screen.getByText('The finished essay')).toBeTruthy();
    expect(screen.getByText('Save as Note')).toBeTruthy();
    expect(screen.getByText('Append to Current')).toBeTruthy();
    expect(screen.getByText('Discard')).toBeTruthy();
  });
});
