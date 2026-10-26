/**
 * @vitest-environment happy-dom
 *
 * The drafted-skill card (#2652): every file shown in full, Save to my
 * skills, a failed save's reason, and buttons that wait while a save is
 * under way. A drafted plugin is a proposal instead (#2890).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import type { ExtensionDraftOffer } from '../../../src/shared/extensions/drafts';
import ExtensionDraftCard from '../../../src/renderer/lib/components/conversations/ExtensionDraftCard.svelte';

const offer = (over: Partial<ExtensionDraftOffer> = {}): ExtensionDraftOffer => ({
  offerId: 'o1',
  conversationId: 'c1',
  kind: 'skill',
  id: 'my.weekly',
  name: 'Weekly Review',
  summary: 'A skill for reviewing the week.',
  files: [{ path: 'weekly.md', content: '---\nid: my.weekly\n---\nHelp me <review> CANARY' }],
  ...over,
});

function mount(over: Partial<ExtensionDraftOffer> = {}, props: { problem?: string | null; busy?: boolean } = {}) {
  const onAct = vi.fn();
  const utils = render(ExtensionDraftCard, { props: { offer: offer(over), problem: props.problem ?? null, busy: props.busy ?? false, onAct } });
  return { ...utils, onAct };
}

afterEach(cleanup);

describe('ExtensionDraftCard (#2652)', () => {
  it('shows what it is, the summary, and every file verbatim', () => {
    const { getByRole, getByText, getByLabelText } = mount();
    expect(getByRole('group', { name: /Drafted skill: Weekly Review my\.weekly/ })).toBeTruthy();
    expect(getByText('A skill for reviewing the week.')).toBeTruthy();
    expect(getByLabelText('Contents of weekly.md').textContent).toBe('---\nid: my.weekly\n---\nHelp me <review> CANARY');
  });

  it('a skill is saved to your skills, and nothing on it installs anything', () => {
    const skill = mount();
    expect(skill.getByRole('button', { name: 'Save to my skills' })).toBeTruthy();
    expect(skill.queryByRole('button', { name: 'Install' })).toBeNull();
  });

  it.each([
    ['Save to my skills', 'save'],
    ['Save to folder…', 'save-folder'],
    ['Not now', 'dismiss'],
  ])('%s asks for %s', async (label, action) => {
    const { getByRole, onAct } = mount();
    await fireEvent.click(getByRole('button', { name: label }));
    expect(onAct).toHaveBeenCalledWith(action);
  });

  it('shows why a save failed, and waits while one is under way', () => {
    const { getByRole, getByText } = mount({}, { problem: 'You already have a skill with the id "my.weekly".', busy: true });
    expect(getByText('You already have a skill with the id "my.weekly".')).toBeTruthy();
    for (const name of ['Save to my skills', 'Save to folder…', 'Not now']) {
      expect((getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
