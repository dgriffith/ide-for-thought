/**
 * @vitest-environment happy-dom
 *
 * axe smoke for the mcp_call confirmation card (#2439). The e2e axe scan of
 * the conversation panel (`tests/e2e/a11y.spec.ts`) can't cheaply put this
 * card on screen — it needs a live model turn against a connected MCP server
 * — so it is scanned here in isolation, the way the modal dialogs are.
 */
import { describe, it, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { expectNoA11yViolations } from '../../helpers/axe';
import McpConfirmCard from '../../../src/renderer/lib/components/conversations/McpConfirmCard.svelte';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

/** In the app the card sits inside the conversation panel's landmark; mount it
 *  in one so axe's "content outside landmarks" rule judges the card, not the
 *  test harness. */
function landmark(): HTMLElement {
  return document.body.appendChild(document.createElement('main'));
}

describe('mcp_call confirmation card accessibility (#2439)', () => {
  it('is axe-clean with a description, a title and long arguments', async () => {
    render(McpConfirmCard, {
      target: landmark(),
      props: {
        request: {
          requestId: 'r1',
          conversationId: 'c1',
          serverName: 'slack',
          toolName: 'post_message',
          title: 'Post message',
          description: 'Post a message to a channel',
          destructiveHint: true,
          argsJson: JSON.stringify({ channel: '#general', lines: Array.from({ length: 60 }, (_, i) => `line ${i}`) }, null, 2),
        },
        onAnswer: () => {},
      },
    });
    await expectNoA11yViolations();
  });

  it('is axe-clean with no description and empty arguments', async () => {
    render(McpConfirmCard, {
      target: landmark(),
      props: {
        request: { requestId: 'r2', conversationId: 'c1', serverName: 's', toolName: 't', argsJson: '{}' },
        onAnswer: () => {},
      },
    });
    await expectNoA11yViolations();
  });
});
