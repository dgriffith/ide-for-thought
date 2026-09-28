/**
 * @vitest-environment happy-dom
 *
 * The mcp_call confirmation card (#2439). It is the only thing between an
 * injected instruction and a third-party write, so the tests pin that the user
 * sees what will be sent and that every answer path means what it says:
 *
 *  - server, tool, description / title, and the arguments VERBATIM;
 *  - Allow / Deny buttons, and Enter / Escape anywhere in the card;
 *  - "Don't ask again" reaches `onAnswer` only with Allow;
 *  - labelled for assistive tech.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import type { McpConfirmRequest } from '../../../src/shared/conversation-tools';
import McpConfirmCard from '../../../src/renderer/lib/components/conversations/McpConfirmCard.svelte';

const ARGS = { channel: '#general', text: 'Summary of <notes>: CANARY', nested: { ids: [1, 2, 3] } };

function request(over: Partial<McpConfirmRequest> = {}): McpConfirmRequest {
  return {
    requestId: 'r1',
    conversationId: 'c1',
    serverName: 'slack',
    toolName: 'post_message',
    description: 'Post a message to a channel',
    argsJson: JSON.stringify(ARGS, null, 2),
    ...over,
  };
}

function mount(over: Partial<McpConfirmRequest> = {}) {
  const onAnswer = vi.fn();
  const utils = render(McpConfirmCard, { props: { request: request(over), onAnswer } });
  return { ...utils, onAnswer };
}

afterEach(cleanup);

describe('McpConfirmCard (#2439)', () => {
  it('shows the server, the tool, its description and the arguments verbatim', () => {
    const { getByTestId, container } = mount();
    const card = getByTestId('mcp-confirm-card');
    expect(card.textContent).toContain('post_message');
    expect(card.textContent).toContain('slack');
    expect(card.textContent).toContain('Post a message to a channel');
    // The exact serialized bytes, markup-like text included, rendered as text.
    expect(container.querySelector('pre')!.textContent).toBe(JSON.stringify(ARGS, null, 2));
    expect(container.querySelector('pre b, pre notes')).toBeNull();
    expect(card.textContent).toContain(`Arguments (${JSON.stringify(ARGS, null, 2).split('\n').length} lines)`);
  });

  it('shows the title when it differs from the tool name, and a destructive hint neutrally', () => {
    const { getByTestId } = mount({ title: 'Post message', destructiveHint: true });
    expect(getByTestId('mcp-confirm-card').textContent).toContain('Post message');
    expect(getByTestId('mcp-confirm-card').textContent).toContain('marks it as destructive');
  });

  it('keeps long arguments in a scrollable, keyboard-focusable region inside a collapsible', () => {
    const long = JSON.stringify(Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, i])), null, 2);
    const { container } = mount({ argsJson: long });
    const details = container.querySelector('details')!;
    expect(details.open).toBe(true);
    const pre = container.querySelector('pre')!;
    expect(pre.getAttribute('tabindex')).toBe('0');
    expect(pre.getAttribute('aria-label')).toMatch(/Arguments/);
    expect(pre.textContent).toBe(long);
  });

  it('Allow and Deny buttons answer', async () => {
    const { getByRole, onAnswer } = mount();
    await fireEvent.click(getByRole('button', { name: 'Allow' }));
    expect(onAnswer).toHaveBeenLastCalledWith(true, false);
    await fireEvent.click(getByRole('button', { name: 'Deny' }));
    expect(onAnswer).toHaveBeenLastCalledWith(false, false);
  });

  it('"Don\'t ask again" goes with Allow, never with Deny', async () => {
    const { getByLabelText, getByRole, onAnswer } = mount();
    await fireEvent.click(getByLabelText("Don't ask again for this tool"));
    await fireEvent.click(getByRole('button', { name: 'Deny' }));
    expect(onAnswer).toHaveBeenLastCalledWith(false, false);
    await fireEvent.click(getByRole('button', { name: 'Allow' }));
    expect(onAnswer).toHaveBeenLastCalledWith(true, true);
  });

  it('Enter inside the card allows (with the checkbox state); Escape denies', async () => {
    const { container, getByLabelText, onAnswer } = mount();
    const checkbox = getByLabelText("Don't ask again for this tool");
    await fireEvent.click(checkbox);
    await fireEvent.keyDown(checkbox, { key: 'Enter' });
    expect(onAnswer).toHaveBeenLastCalledWith(true, true);
    await fireEvent.keyDown(container.querySelector('pre')!, { key: 'Escape' });
    expect(onAnswer).toHaveBeenLastCalledWith(false, false);
  });

  it('Enter on the Deny button is the button\'s own click, not an Allow', async () => {
    const { getByRole, onAnswer } = mount();
    await fireEvent.keyDown(getByRole('button', { name: 'Deny' }), { key: 'Enter' });
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('a modified Enter does nothing', async () => {
    const { container, onAnswer } = mount();
    await fireEvent.keyDown(container.querySelector('pre')!, { key: 'Enter', metaKey: true });
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('is a labelled group, and does not steal focus when it appears', () => {
    const { getByTestId } = mount();
    const group = getByTestId('mcp-confirm-card');
    expect(group.getAttribute('role')).toBe('group');
    const labelId = group.getAttribute('aria-labelledby')!;
    expect(document.getElementById(labelId)!.textContent).toMatch(/Allow post_message on slack\?/);
    expect(document.getElementById(group.getAttribute('aria-describedby')!)).not.toBeNull();
    expect(group.contains(document.activeElement)).toBe(false);
  });
});
