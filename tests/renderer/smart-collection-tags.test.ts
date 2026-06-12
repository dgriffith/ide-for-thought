/**
 * @vitest-environment happy-dom
 *
 * Smart SOURCE collections filter sources by tag, so the tag picker must offer
 * only tags present on some source — not the whole project vocabulary (which
 * includes note-only tags that can never match a source predicate).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';

const { tagsList } = vi.hoisted(() => ({ tagsList: vi.fn() }));
vi.mock('../../src/renderer/lib/ipc/client', () => ({ api: { tags: { list: tagsList } } }));

import SmartCollectionEditorDialog from '../../src/renderer/lib/components/SmartCollectionEditorDialog.svelte';

afterEach(cleanup);

describe('SmartCollectionEditorDialog tag list', () => {
  it('offers only tags on some source, hiding note-only tags', async () => {
    tagsList.mockResolvedValue([
      { tag: 'note-only', noteCount: 3, sourceCount: 0 },
      { tag: 'on-sources', noteCount: 0, sourceCount: 2 },
      { tag: 'on-both', noteCount: 1, sourceCount: 1 },
    ]);

    const { findByText, queryByText } = render(SmartCollectionEditorDialog, {
      editing: undefined,
      onSave: vi.fn(),
      onCancel: vi.fn(),
    });

    // Source tags shown…
    expect(await findByText('#on-sources')).toBeTruthy();
    expect(queryByText('#on-both')).toBeTruthy();
    // …note-only tag hidden.
    expect(queryByText('#note-only')).toBeNull();
  });
});
