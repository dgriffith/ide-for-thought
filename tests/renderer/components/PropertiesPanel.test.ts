/**
 * @vitest-environment happy-dom
 *
 * PropertiesPanel render test (#471 / #1596). The frontmatter property editor is
 * a data-loss-prone surface (it rewrites the note's YAML on every edit) that had
 * 0% coverage of its own `.svelte` file — the round-trip engine lives in the
 * unit-tested `frontmatter-rows.ts`, but the panel's own parse→render→mutate glue
 * was untested. This mounts the real component against a mocked IPC client + a
 * mocked notebase store and asserts the visible rows plus the edit/add/remove
 * interactions that route back through `onContentChange`.
 *
 * The four child components (Icon, PropertyValueEditor, AutocompleteDropdown) and
 * the shared frontmatter/property-shape helpers are pure and render unmocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  api: {
    graph: {
      frontmatterKeys: vi.fn(),
      aliasMap: vi.fn(),
    },
    notebase: {
      listFiles: vi.fn(),
    },
  },
  notebase: {
    onRewritten: vi.fn(() => () => {}),
    onFileCreated: vi.fn(() => () => {}),
    onFileDeleted: vi.fn(() => () => {}),
  },
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));
vi.mock('../../../src/renderer/lib/stores/notebase.svelte', () => ({
  getNotebaseStore: () => h.notebase,
}));

import PropertiesPanel from '../../../src/renderer/lib/components/right-sidebar/PropertiesPanel.svelte';

const CONTENT = [
  '---',
  'title: Hello World',
  'count: 5',
  'done: true',
  'tags:',
  '  - alpha',
  '  - beta',
  'link: "[[Target Note]]"',
  '---',
  '# Body',
  '',
].join('\n');

function props(over: Record<string, unknown> = {}) {
  return {
    content: CONTENT,
    onContentChange: vi.fn(),
    onNavigate: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  h.api.graph.frontmatterKeys.mockResolvedValue([]);
  h.api.graph.aliasMap.mockResolvedValue({});
  h.api.notebase.listFiles.mockResolvedValue([]);
  h.notebase.onRewritten.mockReturnValue(() => {});
  h.notebase.onFileCreated.mockReturnValue(() => {});
  h.notebase.onFileDeleted.mockReturnValue(() => {});
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

/** The final call's rewritten-content argument (edits are parent-controlled, so
 *  the mock captures each rewrite without the prop actually changing). */
function lastRewrite(onContentChange: ReturnType<typeof vi.fn>): string {
  const calls = onContentChange.mock.calls;
  return calls[calls.length - 1]![0] as string;
}

describe('PropertiesPanel (#471 / #1596)', () => {
  it('renders every frontmatter row with its typed value control', async () => {
    render(PropertiesPanel, props());
    // Keys render as editable inputs seeded from the parsed frontmatter.
    expect(screen.getByDisplayValue('title')).toBeTruthy();
    expect(screen.getByDisplayValue('count')).toBeTruthy();
    // Scalar values: string + number editors seeded from content.
    expect(screen.getByDisplayValue('Hello World')).toBeTruthy();
    const num = screen.getByDisplayValue('5');
    expect(num.type).toBe('number');
    // Boolean row renders a checkbox reflecting `done: true`.
    expect((screen.getByRole('checkbox')).checked).toBe(true);
    // string-list row renders one chip per item.
    expect(screen.getByText('alpha')).toBeTruthy();
    expect(screen.getByText('beta')).toBeTruthy();
    // wiki-link row renders a clickable chip labelled by its target.
    expect(screen.getByText('Target Note')).toBeTruthy();
  });

  it('fetches project keys + note basenames and subscribes to notebase events on mount', async () => {
    render(PropertiesPanel, props());
    await waitFor(() => expect(h.api.graph.frontmatterKeys).toHaveBeenCalled());
    expect(h.api.notebase.listFiles).toHaveBeenCalled();
    expect(h.api.graph.aliasMap).toHaveBeenCalled();
    expect(h.notebase.onRewritten).toHaveBeenCalledTimes(1);
    expect(h.notebase.onFileCreated).toHaveBeenCalledTimes(1);
    expect(h.notebase.onFileDeleted).toHaveBeenCalledTimes(1);
  });

  it('toggling a boolean commits the new value immediately through onContentChange', async () => {
    const onContentChange = vi.fn();
    render(PropertiesPanel, props({ onContentChange }));
    await fireEvent.click(screen.getByRole('checkbox'));
    expect(onContentChange).toHaveBeenCalledTimes(1);
    expect(lastRewrite(onContentChange)).toContain('done: false');
  });

  it('editing a string value commits on blur, preserving the note body', async () => {
    const onContentChange = vi.fn();
    render(PropertiesPanel, props({ onContentChange }));
    const input = screen.getByDisplayValue('Hello World');
    input.value = 'Hello Universe';
    await fireEvent.blur(input);
    expect(onContentChange).toHaveBeenCalled();
    const next = lastRewrite(onContentChange);
    expect(next).toContain('title: Hello Universe');
    expect(next).toContain('# Body'); // body survives the round-trip
  });

  it('typing into a scalar value schedules a draft flush (debounced input path)', async () => {
    const onContentChange = vi.fn();
    render(PropertiesPanel, props({ onContentChange }));
    const input = screen.getByDisplayValue('5');
    // oninput drives onScalarInput → scheduleFlush; committing on blur applies it.
    await fireEvent.input(input, { target: { value: '42' } });
    await fireEvent.blur(input);
    expect(onContentChange).toHaveBeenCalled();
    expect(lastRewrite(onContentChange)).toContain('count: 42');
  });

  it('renaming a key rewrites the frontmatter under the new key', async () => {
    const onContentChange = vi.fn();
    render(PropertiesPanel, props({ onContentChange }));
    const keyInput = screen.getByDisplayValue('title');
    await fireEvent.change(keyInput, { target: { value: 'name' } });
    expect(onContentChange).toHaveBeenCalled();
    const next = lastRewrite(onContentChange);
    expect(next).toContain('name: Hello World');
    expect(next).not.toMatch(/^title:/m);
  });

  it('removing a property drops its key from the rewritten frontmatter', async () => {
    const onContentChange = vi.fn();
    render(PropertiesPanel, props({ onContentChange }));
    await fireEvent.click(screen.getByRole('button', { name: 'Remove title' }));
    expect(onContentChange).toHaveBeenCalledTimes(1);
    const next = lastRewrite(onContentChange);
    expect(next).not.toMatch(/^title:/m);
    expect(next).toContain('count: 5'); // siblings untouched
  });

  it('adding a chip to a string-list appends it and rewrites the list', async () => {
    const onContentChange = vi.fn();
    render(PropertiesPanel, props({ onContentChange }));
    const chipInput = screen.getByPlaceholderText('Add…');
    await fireEvent.input(chipInput, { target: { value: 'gamma' } });
    await fireEvent.keyDown(chipInput, { key: 'Enter' });
    expect(onContentChange).toHaveBeenCalled();
    expect(lastRewrite(onContentChange)).toContain('gamma');
  });

  it('removing a chip drops it from the string-list', async () => {
    const onContentChange = vi.fn();
    render(PropertiesPanel, props({ onContentChange }));
    await fireEvent.click(screen.getByRole('button', { name: 'Remove alpha' }));
    expect(onContentChange).toHaveBeenCalledTimes(1);
    const next = lastRewrite(onContentChange);
    expect(next).not.toContain('alpha');
    expect(next).toContain('beta');
  });

  it('opens the type-switch menu and re-types a value on selection', async () => {
    const onContentChange = vi.fn();
    render(PropertiesPanel, props({ onContentChange }));
    // The number row's type icon is a button that opens the type menu.
    await fireEvent.click(screen.getByTitle('Change type (number)'));
    const menu = await screen.findByRole('menu');
    expect(menu).toBeTruthy();
    // Re-type the number as a string → value is stringified + re-coerced.
    const stringItem = screen.getByRole('menuitemradio', { name: 'string' });
    await fireEvent.click(stringItem);
    expect(onContentChange).toHaveBeenCalled();
    expect(lastRewrite(onContentChange)).toMatch(/count:\s*['"]?5['"]?/);
  });

  it('quick-adds a canonical key from a suggestion chip', async () => {
    const onContentChange = vi.fn();
    render(PropertiesPanel, props({ onContentChange }));
    // `creator` is the first canonical suggestion not already present.
    await fireEvent.click(screen.getByRole('button', { name: /\+ creator/ }));
    expect(onContentChange).toHaveBeenCalled();
    expect(lastRewrite(onContentChange)).toMatch(/^creator:/m);
  });

  it('adds a new property from the add-row autocomplete on Enter', async () => {
    const onContentChange = vi.fn();
    render(PropertiesPanel, props({ onContentChange }));
    const addInput = screen.getByPlaceholderText('Add property…');
    await fireEvent.input(addInput, { target: { value: 'status' } });
    await fireEvent.keyDown(addInput, { key: 'Enter' });
    await waitFor(() => expect(onContentChange).toHaveBeenCalled());
    expect(lastRewrite(onContentChange)).toMatch(/^status:/m);
  });

  it('swaps the wiki-link chip for an autocomplete editor and commits a new target', async () => {
    const onContentChange = vi.fn();
    render(PropertiesPanel, props({ onContentChange }));
    await fireEvent.click(screen.getByRole('button', { name: 'Edit link target' }));
    const linkInput = await screen.findByPlaceholderText('Note name…');
    await fireEvent.input(linkInput, { target: { value: 'Other Note' } });
    await fireEvent.keyDown(linkInput, { key: 'Enter' });
    expect(onContentChange).toHaveBeenCalled();
    expect(lastRewrite(onContentChange)).toContain('[[Other Note]]');
  });

  it('invokes onNavigate when the wiki-link chip is clicked', async () => {
    const onNavigate = vi.fn();
    render(PropertiesPanel, props({ onNavigate }));
    await fireEvent.click(screen.getByRole('button', { name: /Target Note/ }));
    expect(onNavigate).toHaveBeenCalledWith('Target Note');
  });

  it('shows the empty state with an Add-property affordance for a note with no frontmatter', async () => {
    render(PropertiesPanel, props({ content: '# Just a body\n' }));
    await waitFor(() => expect(screen.getByText('No frontmatter')).toBeTruthy());
    expect(screen.getByPlaceholderText('Add property…')).toBeTruthy();
  });

  it('surfaces a YAML error banner and disables editing for malformed frontmatter', async () => {
    render(PropertiesPanel, props({ content: '---\ntitle: [unterminated\n---\n# Body\n' }));
    await waitFor(() =>
      expect(screen.getByText('Frontmatter has a YAML error')).toBeTruthy(),
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    // Editing is disabled — no key/value inputs render in the error state.
    expect(screen.queryByDisplayValue('title')).toBeNull();
  });
});
