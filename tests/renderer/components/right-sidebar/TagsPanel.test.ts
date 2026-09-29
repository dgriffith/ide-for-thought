/**
 * @vitest-environment happy-dom
 *
 * `TagsPanel` expand state for tags named after `Object.prototype` members
 * (#2461 follow-up). The state used to be a `Record<string, boolean>` read as
 * `!!expanded[path]`, so `constructor` / `toString` / `hasOwnProperty` read as
 * expanded before anyone touched them, and `__proto__` was not an ordinary key.
 * It is a `SvelteSet` of expanded paths now.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import type { TagInfo } from '../../../../src/shared/types';

const h = vi.hoisted(() => ({
  list: vi.fn(),
}));

vi.mock('../../../../src/renderer/lib/ipc/client', () => ({
  api: {
    tags: {
      list: h.list,
      notesByTag: vi.fn(async () => []),
      sourcesByTag: vi.fn(async () => []),
      notesByTagPrefix: vi.fn(async () => []),
    },
  },
}));

import TagsPanel from '../../../../src/renderer/lib/components/right-sidebar/TagsPanel.svelte';

const STORAGE_KEY = 'minerva.tagsPanel.expanded';
const NAMES = ['constructor', 'toString', '__proto__', 'hasOwnProperty'];
const TAGS: TagInfo[] = NAMES.map((n) => ({ tag: `${n}/leaf`, noteCount: 1, sourceCount: 0 }));
// `#__proto__` isn't body-tag syntax (tags start with a letter), so every tag
// comes in through frontmatter.
const CONTENT = `---\ntags: [${NAMES.map((n) => `"${n}/leaf"`).join(', ')}]\n---\nBody\n`;

function chevronFor(container: HTMLElement, name: string): HTMLButtonElement {
  const row = [...container.querySelectorAll<HTMLElement>('.row')]
    .find((r) => r.querySelector('.tag-name')?.textContent?.trim() === `#${name}/`);
  if (!row) throw new Error(`no row for ${name}`);
  return row.querySelector<HTMLButtonElement>('button.chevron')!;
}

function leafVisible(container: HTMLElement, name: string): boolean {
  return [...container.querySelectorAll<HTMLElement>('.row .tag-name')]
    .some((b) => b.getAttribute('title') === `Show notes tagged exactly #${name}/leaf`);
}

async function renderPanel() {
  const r = render(TagsPanel, { props: { content: CONTENT, onFileSelect: vi.fn() } });
  await waitFor(() => expect(r.container.querySelectorAll('.row').length).toBeGreaterThanOrEqual(NAMES.length));
  return r;
}

beforeEach(() => {
  localStorage.clear();
  h.list.mockResolvedValue(TAGS);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe('TagsPanel — tags named after Object.prototype members', () => {
  it('start collapsed', async () => {
    const { container } = await renderPanel();
    for (const name of NAMES) {
      expect(chevronFor(container, name).getAttribute('aria-label'), name).toBe('Expand');
      expect(leafVisible(container, name), name).toBe(false);
    }
  });

  it('toggle independently of each other', async () => {
    const { container } = await renderPanel();
    for (const [i, name] of NAMES.entries()) {
      await fireEvent.click(chevronFor(container, name));
      await waitFor(() => expect(leafVisible(container, name), name).toBe(true));
      expect(chevronFor(container, name).getAttribute('aria-label')).toBe('Collapse');
      // Only the ones toggled so far are open.
      for (const [j, other] of NAMES.entries()) {
        expect(leafVisible(container, other), `${other} after opening ${name}`).toBe(j <= i);
      }
    }
    await fireEvent.click(chevronFor(container, '__proto__'));
    await waitFor(() => expect(leafVisible(container, '__proto__')).toBe(false));
    for (const name of NAMES.filter((n) => n !== '__proto__')) {
      expect(leafVisible(container, name), name).toBe(true);
    }
  });

  it('persists __proto__ as an ordinary key and restores it', async () => {
    const first = await renderPanel();
    await fireEvent.click(chevronFor(first.container, '__proto__'));
    await fireEvent.click(chevronFor(first.container, 'constructor'));
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as Record<string, unknown>;
    expect(Object.keys(saved).sort()).toEqual(['__proto__', 'constructor']);
    cleanup();

    const { container } = await renderPanel();
    await waitFor(() => expect(leafVisible(container, '__proto__')).toBe(true));
    expect(leafVisible(container, 'constructor')).toBe(true);
    expect(leafVisible(container, 'toString')).toBe(false);
    expect(leafVisible(container, 'hasOwnProperty')).toBe(false);
  });
});
