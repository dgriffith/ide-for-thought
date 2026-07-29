/**
 * @vitest-environment happy-dom
 *
 * Component-interaction coverage for the "Publish → git remote" dialog (#254).
 *
 * PublishDialog reads exporter/target metadata directly (reads are allowed in
 * components) but routes every mutation — add/remove a target, preview, publish —
 * through the publish store, which is a thin passthrough to `api.publish.*`. We
 * mock the ipc-client boundary (the store gets the same mock, so the real
 * store-→api wiring is exercised) and assert:
 *   - the target cards / empty state / add-target form render,
 *   - Save builds the right PublishTarget and reaches upsertTarget,
 *   - Remove reaches removeTarget,
 *   - Preview/Publish call toGit with the correct dryRun flag (the network push
 *     is never run — the mock returns canned data) and render the outcome,
 *   - Close / Escape / backdrop invoke onClose.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';

const { listExporters, listTargets, upsertTarget, removeTarget, toGit } = vi.hoisted(() => ({
  listExporters: vi.fn(),
  listTargets: vi.fn(),
  upsertTarget: vi.fn(),
  removeTarget: vi.fn(),
  toGit: vi.fn(),
}));

// The publish store imports `api` from this same module, so mocking here means
// the real store passes through to these mocks — no separate store stub needed.
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: {
    publish: { listExporters, listTargets, upsertTarget, removeTarget, toGit },
  },
}));

import PublishDialog from '../../../src/renderer/lib/components/PublishDialog.svelte';
import type { PublishTarget, PublishGitResponse } from '../../../src/renderer/lib/ipc/client';

function exporter(id: string, label: string, kinds: string[] = ['project']) {
  return { id, label, acceptedKinds: kinds, group: { id: 'g', label: 'G' }, variantOrder: 0 };
}

function target(over: Partial<PublishTarget> = {}): PublishTarget {
  return {
    id: 'my-garden',
    label: 'My Garden',
    exporter: 'static-site',
    gitRemote: 'git@github.com:you/garden.git',
    gitBranch: 'gh-pages',
    subdir: '.',
    commitMessageTemplate: 'Publish {{date}} from Minerva',
    ...over,
  };
}

function previewResponse(): PublishGitResponse {
  return {
    ok: true,
    result: {
      targetId: 'my-garden',
      dryRun: true,
      branch: 'gh-pages',
      branchCreated: false,
      changes: [
        { path: 'index.html', status: 'added' },
        { path: 'about.html', status: 'modified' },
      ],
      committed: false,
      pushed: false,
    },
  };
}

function publishedResponse(): PublishGitResponse {
  return {
    ok: true,
    result: {
      targetId: 'my-garden',
      dryRun: false,
      branch: 'gh-pages',
      branchCreated: false,
      changes: [{ path: 'index.html', status: 'added' }],
      committed: true,
      pushed: true,
      sha: 'abcdef1234567',
      commitMessage: 'Publish 2026 from Minerva',
    },
  };
}

afterEach(() => {
  cleanup();
  listExporters.mockReset();
  listTargets.mockReset();
  upsertTarget.mockReset();
  removeTarget.mockReset();
  toGit.mockReset();
});

/** Render, then wait for onMount (listTargets + listExporters) to settle —
 *  the "Add target…" button only appears once `loaded` flips true. */
async function renderDialog(
  over: { targets?: PublishTarget[]; exporters?: ReturnType<typeof exporter>[]; onClose?: () => void } = {},
) {
  listTargets.mockResolvedValue(over.targets ?? []);
  listExporters.mockResolvedValue(over.exporters ?? [exporter('static-site', 'Static Site')]);
  const onClose = over.onClose ?? vi.fn();
  const utils = render(PublishDialog, { onClose });
  await utils.findByText('Add target…');
  return { ...utils, onClose };
}

describe('PublishDialog — publish → git remote (#254)', () => {
  it('shows the empty state when there are no targets', async () => {
    const { getByText } = await renderDialog({ targets: [] });
    expect(getByText('No publish targets yet.')).toBeTruthy();
    expect(listTargets).toHaveBeenCalled();
  });

  it('renders a card per configured target with its exporter/remote/branch', async () => {
    const { getByText, container } = await renderDialog({ targets: [target()] });

    expect(getByText('My Garden')).toBeTruthy();
    // "static-site → git@github.com:you/garden.git (gh-pages)" spread across nodes.
    const detail = container.querySelector('.target-detail')!;
    expect(detail.textContent).toContain('static-site');
    expect(detail.textContent).toContain('git@github.com:you/garden.git');
    expect(detail.textContent).toContain('gh-pages');
    expect(getByText('Preview')).toBeTruthy();
    expect(getByText('Publish')).toBeTruthy();
  });

  it('opens the add-target form and Save builds the right PublishTarget through upsertTarget', async () => {
    upsertTarget.mockResolvedValue([]);
    const { getByText, getByPlaceholderText } = await renderDialog({ targets: [] });

    await fireEvent.click(getByText('Add target…'));

    await fireEvent.input(getByPlaceholderText('My Garden'), { target: { value: 'My Garden' } });
    await fireEvent.input(getByPlaceholderText('git@github.com:you/garden.git'), {
      target: { value: 'git@github.com:me/site.git' },
    });

    await fireEvent.click(getByText('Save target'));

    await waitFor(() => expect(upsertTarget).toHaveBeenCalledTimes(1));
    expect(upsertTarget).toHaveBeenCalledWith({
      id: 'my-garden', // slug(label), unique
      label: 'My Garden',
      exporter: 'static-site',
      gitRemote: 'git@github.com:me/site.git',
      gitBranch: 'gh-pages',
      subdir: '.',
      commitMessageTemplate: 'Publish {{date}} from Minerva',
    });
  });

  it('disables Save until label and remote are filled ($derived canSave)', async () => {
    const { getByText, getByPlaceholderText } = await renderDialog({ targets: [] });
    await fireEvent.click(getByText('Add target…'));

    const save = getByText('Save target') as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    await fireEvent.input(getByPlaceholderText('My Garden'), { target: { value: 'Site' } });
    expect(save.disabled).toBe(true); // remote still empty

    await fireEvent.input(getByPlaceholderText('git@github.com:you/garden.git'), {
      target: { value: 'git@github.com:me/site.git' },
    });
    expect(save.disabled).toBe(false);
  });

  it('newly saved target shows in the list (upsert returns the updated list)', async () => {
    upsertTarget.mockResolvedValue([target({ id: 'blog', label: 'Blog' })]);
    const { getByText, getByPlaceholderText, findByText } = await renderDialog({ targets: [] });

    await fireEvent.click(getByText('Add target…'));
    await fireEvent.input(getByPlaceholderText('My Garden'), { target: { value: 'Blog' } });
    await fireEvent.input(getByPlaceholderText('git@github.com:you/garden.git'), {
      target: { value: 'git@github.com:me/blog.git' },
    });
    await fireEvent.click(getByText('Save target'));

    expect(await findByText('Blog')).toBeTruthy();
  });

  it('Remove (✕) routes through removeTarget with the target id', async () => {
    removeTarget.mockResolvedValue([]);
    const { getByTitle } = await renderDialog({ targets: [target()] });

    await fireEvent.click(getByTitle('Remove target'));

    await waitFor(() => expect(removeTarget).toHaveBeenCalledWith('my-garden'));
  });

  it('Preview calls toGit with dryRun:true and renders the change summary', async () => {
    toGit.mockResolvedValue(previewResponse());
    const { getByText, findByText } = await renderDialog({ targets: [target()] });

    await fireEvent.click(getByText('Preview'));

    await waitFor(() => expect(toGit).toHaveBeenCalledWith('my-garden', { dryRun: true }));
    // counts(): "1 added · 1 modified · 0 deleted"
    expect(await findByText(/Preview — 1 added · 1 modified · 0 deleted/)).toBeTruthy();
  });

  it('Publish calls toGit with dryRun:false and renders the published outcome', async () => {
    toGit.mockResolvedValue(publishedResponse());
    const { getByText, findByText } = await renderDialog({ targets: [target()] });

    await fireEvent.click(getByText('Publish'));

    await waitFor(() => expect(toGit).toHaveBeenCalledWith('my-garden', { dryRun: false }));
    expect(await findByText(/Published — 1 added · 0 modified · 0 deleted/)).toBeTruthy();
  });

  it('a failed publish renders the raw git error and a Copy error affordance', async () => {
    toGit.mockResolvedValue({ ok: false, error: 'fatal: could not read Username' });
    const { getByText, findByText } = await renderDialog({ targets: [target()] });

    await fireEvent.click(getByText('Publish'));

    expect(await findByText('Publish failed')).toBeTruthy();
    expect(getByText('fatal: could not read Username')).toBeTruthy();
    expect(getByText('Copy error')).toBeTruthy();
  });

  it('Close invokes onClose', async () => {
    const onClose = vi.fn();
    const { getByText } = await renderDialog({ targets: [], onClose });
    await fireEvent.click(getByText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape and backdrop mousedown invoke onClose', async () => {
    const onClose = vi.fn();
    const { container } = await renderDialog({ targets: [], onClose });
    const backdrop = container.querySelector('.publish-backdrop') as HTMLElement;

    await fireEvent.keyDown(backdrop, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    await fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('only project-scoped exporters populate the form select', async () => {
    const { getByText, container } = await renderDialog({
      targets: [],
      exporters: [
        exporter('static-site', 'Static Site', ['project']),
        exporter('single-md', 'Single Markdown', ['note']),
      ],
    });
    await fireEvent.click(getByText('Add target…'));

    const opts = [...container.querySelectorAll('.form select option')].map((o) => o.textContent);
    expect(opts).toContain('Static Site');
    expect(opts).not.toContain('Single Markdown');
  });
});
