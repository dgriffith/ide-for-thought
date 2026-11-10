/**
 * @vitest-environment happy-dom
 *
 * "Ask in parallel…" (#2974): from the composer, through the dialog's three
 * ways — models, perspectives, attempts — to the store; and the join shown
 * side by side, each answer openable as its branch. Axe-clean.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen, within, waitFor } from '@testing-library/svelte';
import { expectNoA11yViolations } from '../../helpers/axe';
import type { TabRuntime } from '../../../src/renderer/lib/stores/conversations.svelte';

const h = vi.hoisted(() => ({
  store: { send: vi.fn(), setComposer: vi.fn(), cancel: vi.fn(), runBuiltinCommand: vi.fn(), askInParallel: vi.fn(), openBranchTab: vi.fn() },
  getSettings: vi.fn(),
}));

vi.mock('../../../src/renderer/lib/stores/conversations.svelte', () => ({ getConversationsStore: () => h.store }));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: { tools: { getSettings: h.getSettings } } }));
vi.mock('../../../src/renderer/lib/voice/voice.svelte', () => ({
  getVoiceStore: () => ({ status: 'idle', recording: false, busy: false, surface: null, error: null, modelProgress: null }),
}));
vi.mock('../../../src/renderer/lib/voice/voice-settings.svelte', () => ({ voiceSettings: { enabled: false } }));
vi.mock('../../../src/renderer/lib/tools/tool-registry', () => ({ getSlashCommands: () => [] }));

import Composer from '../../../src/renderer/lib/components/conversations/Composer.svelte';
import ForkAnswers from '../../../src/renderer/lib/components/conversations/ForkAnswers.svelte';

const tab = (composer: string) => ({
  id: 'tab-1', streaming: false, composer,
  conversation: { id: 'c1', contextBundle: {}, status: 'active', startedAt: 't', messages: [] },
}) as unknown as TabRuntime;

beforeEach(() => {
  for (const f of Object.values(h.store)) f.mockReset();
  h.getSettings.mockResolvedValue({ forkMaxBranches: 3, customModels: [{ id: 'local-llama', label: 'Local Llama' }] });
});
afterEach(() => { cleanup(); document.body.innerHTML = ''; });

async function openDialog() {
  render(Composer, { tab: tab('Is it safe?'), currentNotePath: 'notes/a.md' });
  await fireEvent.click(screen.getByRole('button', { name: 'Ask in parallel…' }));
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => expect(h.getSettings).toHaveBeenCalled());
  return dialog;
}

describe('Ask in parallel from the composer (#2974)', () => {
  it('is offered only when there is something to ask', () => {
    render(Composer, { tab: tab(''), currentNotePath: null });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Ask in parallel…' }).disabled).toBe(true);
  });

  it('perspectives: one branch per line, sent with the message\'s note', async () => {
    const dialog = await openDialog();
    expect(within(dialog).getByText('Is it safe?')).toBeTruthy();
    await fireEvent.click(within(dialog).getByLabelText('From different perspectives'));
    const ask = () => within(dialog).getByRole<HTMLButtonElement>('button', { name: /^Ask/ });
    await fireEvent.input(within(dialog).getByLabelText(/Perspectives, one per line/), { target: { value: 'a skeptic' } });
    expect(ask().disabled).toBe(true); // one isn't parallel
    await fireEvent.input(within(dialog).getByLabelText(/Perspectives, one per line/), { target: { value: 'a skeptic\n\nan engineer' } });
    expect(ask().textContent).toContain('Ask 2 ways');
    // The dialog itself (the bare composer has no landmark around it here).
    await expectNoA11yViolations(dialog);
    await fireEvent.click(ask());
    expect(h.store.askInParallel).toHaveBeenCalledWith(
      [{ title: 'a skeptic', perspective: 'a skeptic' }, { title: 'an engineer', perspective: 'an engineer' }],
      'notes/a.md',
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('models: one branch per model ticked, a local one included, no more than the limit', async () => {
    const dialog = await openDialog();
    const local = await within(dialog).findByLabelText('Local Llama');
    const boxes = within(dialog).getAllByRole<HTMLInputElement>('checkbox');
    await fireEvent.click(boxes[0]!);
    await fireEvent.click(local);
    await fireEvent.click(boxes[1]!);
    // The limit (3) reached: the rest can't be ticked.
    expect(boxes.filter((b) => !b.checked).every((b) => b.disabled)).toBe(true);
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Ask 3 ways' }));
    const [branches] = h.store.askInParallel.mock.calls[0]! as [{ title: string; model: string }[]];
    expect(branches).toHaveLength(3);
    expect(branches).toContainEqual({ title: 'Local Llama', model: 'local-llama' });
  });

  it('attempts: the same message several times, Cancel sends nothing', async () => {
    const dialog = await openDialog();
    await fireEvent.click(within(dialog).getByLabelText('Several times'));
    await fireEvent.input(within(dialog).getByLabelText(/How many times/), { target: { value: '2' } });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(h.store.askInParallel).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the join, side by side (#2974)', () => {
  it('one column per answer, a stopped one saying so, each openable as its branch', async () => {
    const target = document.body.appendChild(document.createElement('main'));
    const r = render(ForkAnswers, {
      target,
      props: {
        answers: [
          { title: 'a skeptic', conversationId: 'b1', status: 'done', answer: '**No.**' },
          { title: 'an engineer', conversationId: 'b2', status: 'stopped', answer: '', note: 'stopped' },
        ],
      },
    });
    const list = r.getByRole('list', { name: 'Answers side by side' });
    expect(within(list).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['a skeptic', 'an engineer, stopped']);
    expect(r.getByText('No.', { selector: 'strong' })).toBeTruthy();
    expect(r.getByText('No answer.')).toBeTruthy();
    await fireEvent.click(r.getByRole('button', { name: 'Continue in branch an engineer' }));
    expect(h.store.openBranchTab).toHaveBeenCalledWith('b2');
    await expectNoA11yViolations(document.body);
  });
});
