/**
 * @vitest-environment node
 *
 * `offer_extension_draft` (#2652): the model's draft is checked before the
 * user sees it, a bad one comes back with every problem and shows nothing,
 * and the tool's answer is what the user did. It is template-scoped: only a
 * skill that asks for it gets it.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../src/main/skills/loader', () => ({
  getSkillCatalog: async () => ({ skills: [{ id: 'analysis.steelman' }], errors: [] }),
}));
vi.mock('../../../../src/main/plugins/registry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/main/plugins/registry')>()),
  pluginsAppVersion: () => '4.0.0',
}));

import { offerExtensionDraft } from '../../../../src/main/llm/tools/offer-extension-draft';
import { buildConversationTools, NOTEBASE_TOOL_REGISTRY } from '../../../../src/main/llm/tools/registry';
import type { ToolCallbacks, ToolContext } from '../../../../src/main/llm/tools/types';
import type { ExtensionDraftOutcome } from '../../../../src/shared/extensions/drafts';

const CTX = {} as ToolContext;
const SKILL = '---\nid: my.weekly\nname: Weekly Review\ndescription: Review the week\nmenu: Analysis\noutputMode: openConversation\n---\nHelp me review my week.\n';
const INPUT = { kind: 'skill', summary: 'A weekly review.', files: [{ path: 'weekly.md', content: SKILL }] };

const offering = (outcome: ExtensionDraftOutcome) => {
  const offerExtensionDraft = vi.fn(async () => outcome);
  return { callbacks: { offerExtensionDraft } as ToolCallbacks, offerExtensionDraft };
};

describe('offer_extension_draft (#2652)', () => {
  it('shows the checked draft and answers with what the user did', async () => {
    const { callbacks, offerExtensionDraft: shown } = offering({ kind: 'saved', where: '/home/u/.minerva/skills/weekly.md' });
    const r = await offerExtensionDraft.run(CTX, INPUT, callbacks);
    expect(shown).toHaveBeenCalledWith({ kind: 'skill', id: 'my.weekly', name: 'Weekly Review', summary: 'A weekly review.', files: INPUT.files });
    expect(r).toEqual({ isError: false, content: expect.stringContaining('saved the skill to /home/u/.minerva/skills/weekly.md') });
  });

  it.each([
    [{ kind: 'saved', where: '/p/lab' }, 'plugin', /installed the plugin \(\/p\/lab\).*off until they switch it on/],
    [{ kind: 'saved-folder', where: '/work/lab' }, 'skill', /saved the draft to \/work\/lab\. Nothing is installed/],
    [{ kind: 'dismissed' }, 'skill', /dismissed the draft/],
    [{ kind: 'cancelled' }, 'skill', /turn ended before the user chose/],
    [{ kind: 'no-ui' }, 'skill', /no window/],
  ] as const)('tells the model %j', async (outcome, kind, msg) => {
    const input = kind === 'skill' ? INPUT : {
      kind: 'plugin', summary: 'A lab.',
      files: [{ path: 'plugin.json', content: JSON.stringify({ id: 'lab', name: 'Lab', version: '0.1.0', minerva: '>=3.0.0', description: 'A lab.', contributes: { skills: ['skills/w.md'] } }) },
        { path: 'skills/w.md', content: SKILL.replace('my.weekly', 'lab.weekly') }],
    };
    const r = await offerExtensionDraft.run(CTX, input, offering(outcome).callbacks);
    expect(r.content).toMatch(msg);
  });

  it('a draft that fails the check comes back with its problems, and nothing is shown', async () => {
    const { callbacks, offerExtensionDraft: shown } = offering({ kind: 'dismissed' });
    const r = await offerExtensionDraft.run(CTX, { ...INPUT, files: [{ path: '../weekly.md', content: SKILL.replace('my.weekly', 'analysis.steelman') }] }, callbacks);
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/^The draft wasn't shown; fix these and offer it again:\n- /);
    expect(shown).not.toHaveBeenCalled();
  });

  it('a taken skill id is refused before the card', async () => {
    const { callbacks } = offering({ kind: 'dismissed' });
    const r = await offerExtensionDraft.run(CTX, { ...INPUT, files: [{ path: 'w.md', content: SKILL.replace('my.weekly', 'analysis.steelman') }] }, callbacks);
    expect(r).toMatchObject({ isError: true, content: expect.stringContaining('"analysis.steelman" already exists') });
  });

  it('with no conversation UI it shows nothing and says so', async () => {
    expect(await offerExtensionDraft.run(CTX, INPUT, {})).toMatchObject({ isError: true, content: expect.stringContaining('no conversation window') });
  });

  it('is offered only to a skill that asks for it', async () => {
    expect(NOTEBASE_TOOL_REGISTRY.offer_extension_draft).toBeUndefined();
    const names = async (extraTools?: ('offer_extension_draft')[]) => (await buildConversationTools({ extraTools })).map((t) => t.name);
    expect(await names()).not.toContain('offer_extension_draft');
    expect(await names(['offer_extension_draft'])).toContain('offer_extension_draft');
  });
});
