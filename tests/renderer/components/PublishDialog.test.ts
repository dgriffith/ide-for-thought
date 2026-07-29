/**
 * @vitest-environment happy-dom
 *
 * PublishDialog S3 target flow (#1444). The store is a thin passthrough to
 * `api.publish`, so mocking the client covers both. Verifies the kind switch
 * reveals S3 fields, "Test connection" calls `checkS3`, and Save builds an S3
 * target carrying the write-only secret. (Git path is unchanged.)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';

const api = vi.hoisted(() => ({
  publish: {
    listTargets: vi.fn(async () => []),
    listExporters: vi.fn(async () => [{ id: 'static-site', label: 'Static Site', acceptedKinds: ['project'] }]),
    upsertTarget: vi.fn(async (t: unknown) => [t]),
    removeTarget: vi.fn(async () => []),
    toGit: vi.fn(),
    checkS3: vi.fn(async () => ({ ok: true })),
    checkGitHub: vi.fn(async () => ({ ok: true })),
  },
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api }));

import PublishDialog from '../../../src/renderer/lib/components/PublishDialog.svelte';

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

async function openS3Form() {
  const view = render(PublishDialog, { onClose: vi.fn() });
  await view.findByText('Add target…');
  await fireEvent.click(view.getByText('Add target…'));
  await fireEvent.click(view.getByText('S3 bucket'));
  return view;
}

describe('PublishDialog — S3 target', () => {
  it('the kind switch reveals S3 fields (bucket), hides the git remote field', async () => {
    const { getByLabelText, queryByLabelText } = await openS3Form();
    expect(getByLabelText('Bucket')).toBeTruthy();
    expect(queryByLabelText('Remote URL')).toBeNull();
  });

  it('Test connection calls checkS3 with the entered config and shows the result', async () => {
    const { getByLabelText, getByText, findByText } = await openS3Form();
    await fireEvent.input(getByLabelText('Bucket'), { target: { value: 'my-bucket' } });
    await fireEvent.click(getByText('Test connection'));
    expect(api.publish.checkS3).toHaveBeenCalledWith(expect.objectContaining({ bucket: 'my-bucket' }));
    await findByText(/Reached the bucket/);
  });

  it('Save builds an S3 target with the write-only secret', async () => {
    const { getByLabelText, getByText } = await openS3Form();
    await fireEvent.input(getByLabelText('Label'), { target: { value: 'My Site' } });
    await fireEvent.input(getByLabelText('Bucket'), { target: { value: 'my-bucket' } });
    await fireEvent.input(getByLabelText('Secret access key'), { target: { value: 'sk-secret' } });
    await fireEvent.click(getByText('Save target'));

    expect(api.publish.upsertTarget).toHaveBeenCalledTimes(1);
    const saved = api.publish.upsertTarget.mock.calls[0]![0] as Record<string, unknown>;
    expect(saved).toMatchObject({ kind: 's3', label: 'My Site', bucket: 'my-bucket', secretAccessKey: 'sk-secret' });
    expect(saved.gitRemote).toBeUndefined();
  });

  it('Save omits the secret when none was typed (tri-state keep)', async () => {
    const { getByLabelText, getByText } = await openS3Form();
    await fireEvent.input(getByLabelText('Label'), { target: { value: 'My Site' } });
    await fireEvent.input(getByLabelText('Bucket'), { target: { value: 'my-bucket' } });
    await fireEvent.click(getByText('Save target'));
    const saved = api.publish.upsertTarget.mock.calls[0]![0] as Record<string, unknown>;
    expect('secretAccessKey' in saved).toBe(false);
  });
});

describe('PublishDialog — git target token (#1508)', () => {
  async function openGitForm() {
    const view = render(PublishDialog, { onClose: vi.fn() });
    await view.findByText('Add target…');
    await fireEvent.click(view.getByText('Add target…')); // git is the default kind
    return view;
  }

  it('Save includes the write-only GitHub token when typed, omits it otherwise', async () => {
    const view = await openGitForm();
    await fireEvent.input(view.getByLabelText('Label'), { target: { value: 'Site' } });
    await fireEvent.input(view.getByLabelText('Remote URL'), { target: { value: 'https://github.com/me/site' } });
    await fireEvent.input(view.getByLabelText('GitHub token (optional)'), { target: { value: 'ghp_x' } });
    await fireEvent.click(view.getByText('Save target'));
    let saved = api.publish.upsertTarget.mock.calls[0]![0] as Record<string, unknown>;
    expect(saved).toMatchObject({ gitRemote: 'https://github.com/me/site', githubToken: 'ghp_x' });
    expect(saved.kind).toBeUndefined(); // git targets carry no explicit kind

    cleanup();
    vi.clearAllMocks();
    const v2 = await openGitForm();
    await fireEvent.input(v2.getByLabelText('Label'), { target: { value: 'Site' } });
    await fireEvent.input(v2.getByLabelText('Remote URL'), { target: { value: 'https://github.com/me/site' } });
    await fireEvent.click(v2.getByText('Save target'));
    saved = api.publish.upsertTarget.mock.calls[0]![0] as Record<string, unknown>;
    expect('githubToken' in saved).toBe(false);
  });

  it('Test connection calls checkGitHub with the typed token', async () => {
    const view = await openGitForm();
    await fireEvent.input(view.getByLabelText('GitHub token (optional)'), { target: { value: 'ghp_x' } });
    await fireEvent.click(view.getByText('Test connection'));
    expect(api.publish.checkGitHub).toHaveBeenCalledWith({ token: 'ghp_x' });
    await view.findByText(/accepted the token/);
  });
});
