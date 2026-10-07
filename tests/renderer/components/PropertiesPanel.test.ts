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
    // The panel resolves the active note's declared type schema (absorbed
    // from the old Fields panel) when given an activeFilePath.
    types: {
      noteProperties: vi.fn(),
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
const showConfirm = vi.hoisted(() => vi.fn());
vi.mock('../../../src/renderer/lib/stores/dialogs.svelte', () => ({
  getDialogStore: () => ({ showConfirm }),
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
  h.api.types.noteProperties.mockResolvedValue({ type: null, properties: [] });
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

// Drafts / new-chip text are keyed by frontmatter key (user text). As `$state`
// records, an undrafted `constructor:` row read `drafts.constructor` — the
// `Object` function — instead of its value (#2461 follow-up).
describe('PropertiesPanel — keys named after Object.prototype members', () => {
  const PROTO_CONTENT = [
    '---',
    'constructor: foo',
    'toString: bar',
    '__proto__: baz',
    'hasOwnProperty:',
    '  - one',
    '---',
    '# Body',
    '',
  ].join('\n');

  it('shows each value, not an inherited function', () => {
    render(PropertiesPanel, props({ content: PROTO_CONTENT }));
    for (const v of ['foo', 'bar', 'baz']) expect(screen.getByDisplayValue(v)).toBeTruthy();
    expect(screen.queryByDisplayValue(/native code|function/)).toBeNull();
    expect(screen.getByPlaceholderText('Add…').value).toBe('');
  });

  it('edits one without touching the others', async () => {
    const onContentChange = vi.fn();
    render(PropertiesPanel, props({ content: PROTO_CONTENT, onContentChange }));
    const input = screen.getByDisplayValue('foo');
    await fireEvent.input(input, { target: { value: 'changed' } });
    await fireEvent.blur(input);
    const next = lastRewrite(onContentChange);
    expect(next).toContain('constructor: changed');
    expect(next).toContain('toString: bar');
    expect(next).toContain('__proto__: baz');
    expect(next).toContain('# Body');
  });
});

// ── Declared type fields (merged in from the retired Fields panel) ──────────
//
// The Fields panel duplicated this panel: same frontmatter keys, same buffer,
// same YAML patch path. It's folded in here as a schema-driven form above the
// raw keys, so the two can't drift apart or disagree about a value.

const BOOK_SCHEMA = {
  type: { id: 'book', label: 'Book', classLocalName: 'Book', source: 'stock', icon: '📖', properties: [] },
  properties: [
    { name: 'author', type: 'text', label: 'Author', value: null },
    { name: 'rating', type: 'number', label: 'Rating', value: null },
    { name: 'status', type: 'enum', label: 'Status', options: ['to-read', 'reading', 'read'], value: null },
    { name: 'published', type: 'date', label: 'Published', value: null },
  ],
};

const TYPED_CONTENT = [
  '---',
  'type: book',
  'author: Frank Herbert',
  'rating: 5',
  'tags:',
  '  - scifi',
  '---',
  '# Dune',
  '',
].join('\n');

function typedProps(over: Record<string, unknown> = {}) {
  return {
    content: TYPED_CONTENT,
    onContentChange: vi.fn(),
    onNavigate: vi.fn(),
    activeFilePath: 'Dune.md',
    revision: 0,
    ...over,
  };
}

describe('PropertiesPanel — declared type fields', () => {
  beforeEach(() => {
    h.api.types.noteProperties.mockResolvedValue(BOOK_SCHEMA);
  });

  it('heads the panel with the type and renders its declared fields', async () => {
    render(PropertiesPanel, typedProps());
    await waitFor(() => expect(screen.getByText('Book')).toBeTruthy());
    expect(screen.getByDisplayValue('Frank Herbert')).toBeTruthy();
    expect((screen.getByDisplayValue('5')).type).toBe('number');
  });

  it('shows a declared property that the note has not set yet', async () => {
    // The point of a schema: the form answers "what does a Book need?", not
    // just "what has this note got?". `published` is absent from the content.
    render(PropertiesPanel, typedProps());
    await waitFor(() => expect(screen.getByText('Published')).toBeTruthy());
    const field = screen.getByText('Published').parentElement!;
    expect(field.classList.contains('unset')).toBe(true);
    expect(field.querySelector('input')!.value).toBe('');
  });

  it('constrains an enum to its declared options', async () => {
    render(PropertiesPanel, typedProps());
    await waitFor(() => expect(screen.getByText('Status')).toBeTruthy());
    const select = screen.getByText('Status').parentElement!.querySelector('select')!;
    expect([...select.options].map((o) => o.value)).toEqual(['', 'to-read', 'reading', 'read']);
  });

  it('renders a declared key as a label, never an editable input', async () => {
    // Renaming a declared key on one note would detach it from the schema with
    // nothing to show for it; the type editor is where a rename belongs.
    render(PropertiesPanel, typedProps());
    await waitFor(() => expect(screen.getByText('Author')).toBeTruthy());
    expect(screen.queryByDisplayValue('author')).toBeNull();
    expect(screen.getByText('Author').tagName).toBe('SPAN');
  });

  it('does not repeat a declared key in the Other list', async () => {
    render(PropertiesPanel, typedProps());
    await waitFor(() => expect(screen.getByText('Book')).toBeTruthy());
    // `type` and `tags` are the note's own keys; author/rating are declared.
    expect(screen.getByDisplayValue('type')).toBeTruthy();
    expect(screen.getByDisplayValue('tags')).toBeTruthy();
    expect(screen.queryByDisplayValue('rating')).toBeNull();
    expect(screen.getByText('Other')).toBeTruthy();
  });

  it('writes a declared field edit back to the frontmatter, preserving the body', async () => {
    const onContentChange = vi.fn();
    render(PropertiesPanel, typedProps({ onContentChange }));
    // Wait for the schema: until it lands, `author` renders in the Other list
    // whose editor commits on blur, so we'd be driving the wrong control.
    await waitFor(() => expect(screen.getByText('Book')).toBeTruthy());
    const author = screen.getByDisplayValue('Frank Herbert');
    await fireEvent.change(author, { target: { value: 'F. Herbert' } });

    const next = lastRewrite(onContentChange);
    expect(next).toContain('author: F. Herbert');
    expect(next).toContain('# Dune');
    expect(next).toContain('type: book');
  });

  it('clearing a declared field drops the key rather than leaving it blank', async () => {
    const onContentChange = vi.fn();
    render(PropertiesPanel, typedProps({ onContentChange }));
    // Wait for the schema: until it lands, `author` renders in the Other list
    // whose editor commits on blur, so we'd be driving the wrong control.
    await waitFor(() => expect(screen.getByText('Book')).toBeTruthy());
    const author = screen.getByDisplayValue('Frank Herbert');
    await fireEvent.change(author, { target: { value: '' } });

    const next = lastRewrite(onContentChange);
    expect(next).not.toContain('author:');
    expect(next).toContain('# Dune');
  });

  it('a declared boolean is a checkbox that writes a real YAML boolean (#2431)', async () => {
    h.api.types.noteProperties.mockResolvedValue({
      ...BOOK_SCHEMA,
      properties: [{ name: 'owned', type: 'boolean', label: 'Owned', value: null }],
    });
    const onContentChange = vi.fn();
    render(PropertiesPanel, typedProps({ onContentChange }));
    await waitFor(() => expect(screen.getByText('Owned')).toBeTruthy());
    const box = screen.getByText('Owned').parentElement!.querySelector('input[type="checkbox"]')!;
    await fireEvent.click(box);
    expect(lastRewrite(onContentChange)).toContain('\nowned: true\n');
  });

  describe('a declared datetime (#2613)', () => {
    const EVENT_SCHEMA = {
      type: { id: 'event', label: 'Event', classLocalName: 'Event', source: 'stock', icon: '📅', properties: [] },
      properties: [{ name: 'date', type: 'datetime', label: 'Date', value: null }],
    };
    const eventProps = (date: string, over: Record<string, unknown> = {}) =>
      typedProps({ content: ['---', 'type: event', `date: ${date}`, '---', '# Talk', ''].join('\n'), ...over });
    const field = () => screen.getByText('Date').parentElement!.querySelector<HTMLInputElement>('input[type="text"]')!;

    beforeEach(() => { h.api.types.noteProperties.mockResolvedValue(EVENT_SCHEMA); });

    it('is a typed text field showing the value as written', async () => {
      render(PropertiesPanel, eventProps('2026-10-05T14:30'));
      await waitFor(() => expect(screen.getByText('Date')).toBeTruthy());
      expect(field().value).toBe('2026-10-05T14:30');
      expect(field().getAttribute('placeholder')).toBe('YYYY-MM-DDTHH:mm');
      expect(field().getAttribute('aria-invalid')).toBeNull();
    });

    it('shows a partial or date-only value as written, not as a timestamp', async () => {
      render(PropertiesPanel, eventProps('1969'));
      await waitFor(() => expect(screen.getByText('Date')).toBeTruthy());
      expect(field().value).toBe('1969');
      cleanup();
      render(PropertiesPanel, eventProps('2026-10-05'));
      await waitFor(() => expect(screen.getByText('Date')).toBeTruthy());
      expect(field().value).toBe('2026-10-05');
    });

    it('writes typed values back as written: a time, a date, a bare year', async () => {
      const onContentChange = vi.fn();
      render(PropertiesPanel, eventProps('2026-10-05', { onContentChange }));
      await waitFor(() => expect(screen.getByText('Date')).toBeTruthy());

      await fireEvent.change(field(), { target: { value: ' 2026-10-05T09:15 ' } });
      expect(lastRewrite(onContentChange)).toMatch(/\ndate: 2026-10-05T09:15\n/);

      await fireEvent.change(field(), { target: { value: '1969' } });
      const next = lastRewrite(onContentChange);
      expect(next).toMatch(/\ndate: ["']?1969["']?\n/); // still 1969, never 1969-01-01T00:00
      expect(next).not.toMatch(/1969-/);
      expect(next).toContain('# Talk');
    });

    it('marks a value it can\'t read as invalid, without rewriting it', async () => {
      const onContentChange = vi.fn();
      render(PropertiesPanel, eventProps('next tuesday', { onContentChange }));
      await waitFor(() => expect(screen.getByText('Date')).toBeTruthy());
      expect(field().value).toBe('next tuesday');
      expect(field().getAttribute('aria-invalid')).toBe('true');
      expect(onContentChange).not.toHaveBeenCalled();
    });

    it('commits the picker\'s value as a floating local time', async () => {
      const onContentChange = vi.fn();
      render(PropertiesPanel, eventProps('2026-10-05T14:30', { onContentChange }));
      await waitFor(() => expect(screen.getByText('Date')).toBeTruthy());
      const picker = screen.getByText('Date').parentElement!.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
      expect(picker.value).toBe('2026-10-05T14:30');
      expect(screen.getByRole('button', { name: 'Pick Date' })).toBeTruthy();
      await fireEvent.change(picker, { target: { value: '2026-10-07T08:00' } });
      expect(lastRewrite(onContentChange)).toMatch(/\ndate: 2026-10-07T08:00\n/);
    });
  });

  it('keeps the rich editor for a declared property holding a list', async () => {
    // A declared `text` property whose actual value is a YAML list must not be
    // flattened into a single-line input on the next commit.
    h.api.types.noteProperties.mockResolvedValue({
      ...BOOK_SCHEMA,
      properties: [{ name: 'tags', type: 'text', label: 'Tags', value: null }],
    });
    render(PropertiesPanel, typedProps());
    await waitFor(() => expect(screen.getByText('Tags')).toBeTruthy());
    // Chip UI, not a plain text input seeded with "[object Object]" etc.
    expect(screen.getByText('scifi')).toBeTruthy();
  });

  it('stays the plain frontmatter editor for an untyped note', async () => {
    h.api.types.noteProperties.mockResolvedValue({ type: null, properties: [] });
    render(PropertiesPanel, typedProps());
    await waitFor(() => expect(screen.getByDisplayValue('author')).toBeTruthy());
    expect(screen.queryByText('Book')).toBeNull();
    expect(screen.queryByText('Other')).toBeNull();
  });
});

describe('PropertiesPanel — fills the type\'s body placeholders on a committed edit (#2491)', () => {
  const SCHEMA = { ...BOOK_SCHEMA, type: { ...BOOK_SCHEMA.type, effectivePropertyNames: ['author', 'rating', 'status', 'published'] } };
  const content = ['---', 'type: book', 'author:', '---', '# Dune', '', 'By {{author}}, rated {{rating}}.', ''].join('\n');

  beforeEach(() => {
    h.api.types.noteProperties.mockResolvedValue(SCHEMA);
  });

  it('sets the property and fills its placeholder in ONE content change, leaving the others', async () => {
    const onContentChange = vi.fn();
    render(PropertiesPanel, typedProps({ content, onContentChange }));
    await waitFor(() => expect(screen.getByText('Book')).toBeTruthy());
    const author = screen.getAllByRole('textbox').find((el) => (el as HTMLInputElement).value === '')!;
    await fireEvent.change(author, { target: { value: 'Frank Herbert' } });

    expect(onContentChange).toHaveBeenCalledTimes(1); // one change → one undo
    const next = lastRewrite(onContentChange);
    expect(next).toContain('author: Frank Herbert');
    expect(next).toContain('By Frank Herbert, rated {{rating}}.');
  });

  it('never rewrites text a placeholder was already filled with', async () => {
    const filled = content.replace('author:', 'author: Frank Herbert').replace('{{author}}', 'Frank Herbert');
    const onContentChange = vi.fn();
    render(PropertiesPanel, typedProps({ content: filled, onContentChange }));
    await waitFor(() => expect(screen.getByText('Book')).toBeTruthy());
    await fireEvent.change(screen.getByDisplayValue('Frank Herbert'), { target: { value: 'F. Herbert' } });
    const next = lastRewrite(onContentChange);
    expect(next).toContain('author: F. Herbert');
    expect(next).toContain('By Frank Herbert, rated {{rating}}.');
  });

  it('does nothing to the body of an untyped note', async () => {
    h.api.types.noteProperties.mockResolvedValue({ type: null, properties: [] });
    const plain = ['---', 'author: x', '---', '{{author}}', ''].join('\n');
    const onContentChange = vi.fn();
    render(PropertiesPanel, typedProps({ content: plain, onContentChange }));
    await fireEvent.blur(screen.getByDisplayValue('x'), { target: { value: 'y' } });
    for (const call of onContentChange.mock.calls) expect(call[0]).toContain('{{author}}');
  });
});

// ── Plain-text names on a link-to-type property (#2612) ───────────────────
//
// Meeting inherits Event's link-to-Person `attendees`, but every existing
// meeting note holds names. The panel shows them as the text they are — not
// as a wiki-link chip, and not with the broken-link warning.

const MEETING_SCHEMA = {
  type: { id: 'meeting', label: 'Meeting', classLocalName: 'Meeting', source: 'stock', icon: '🗓️', parent: 'event', properties: [] },
  properties: [
    { name: 'date', type: 'date', label: 'Date', value: null },
    { name: 'attendees', type: 'link-to-type', targetType: 'person', label: 'Attendees', value: null },
    { name: 'organizer', type: 'link-to-type', targetType: 'person', label: 'Organizer', value: null },
  ],
};

describe('PropertiesPanel — plain-text names on a link property (#2612)', () => {
  beforeEach(() => {
    h.api.types.noteProperties.mockResolvedValue(MEETING_SCHEMA);
    h.api.types.instances = vi.fn().mockResolvedValue({ type: null, instances: [] });
  });

  it('a comma-separated string shows as text in the field', async () => {
    const content = ['---', 'type: meeting', 'attendees: Alice, Bob', '---', ''].join('\n');
    const { container } = render(PropertiesPanel, typedProps({ content }));
    await waitFor(() => expect(screen.getByText('Meeting')).toBeTruthy());
    expect(screen.getByDisplayValue('Alice, Bob')).toBeTruthy();
    expect(container.querySelector('.wiki-chip')).toBeNull();
  });

  it('a YAML list of names shows as plain chips, not broken links', async () => {
    const content = ['---', 'type: meeting', 'attendees:', '  - Alice', '  - Bob', '---', ''].join('\n');
    const { container } = render(PropertiesPanel, typedProps({ content }));
    await waitFor(() => expect(screen.getByText('Meeting')).toBeTruthy());
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(container.querySelector('.wiki-chip')).toBeNull();
    expect(container.querySelector('.broken')).toBeNull();
  });
});

describe('PropertiesPanel — Link attendees (#2612)', () => {
  const PEOPLE = [
    { path: 'people/Alice.md', title: 'Alice', values: {}, cover: null },
    { path: 'people/p-002.md', title: 'Bob Jones', values: {}, cover: null },
  ];
  const meetingNote = (attendees: string, eol = '\n') =>
    ['---', 'type: meeting', attendees, '---', '## Agenda', ''].join(eol);

  beforeEach(() => {
    h.api.types.noteProperties.mockResolvedValue(MEETING_SCHEMA);
    h.api.types.instances = vi.fn().mockResolvedValue({ type: null, instances: PEOPLE });
    h.api.notebase.listFiles.mockResolvedValue(PEOPLE.map((p) => ({ name: p.path, relativePath: p.path, isDirectory: false })));
    showConfirm.mockReset();
  });

  it('offers the action when a name matches, and confirms what will change', async () => {
    showConfirm.mockResolvedValue(true);
    const onContentChange = vi.fn();
    render(PropertiesPanel, typedProps({ content: meetingNote('attendees: Alice, Bob Jones, Zed'), onContentChange }));
    const btn = await screen.findByRole('button', { name: 'Link attendees' });
    expect(h.api.types.instances).toHaveBeenCalledWith('person');
    await fireEvent.click(btn);

    await waitFor(() => expect(onContentChange).toHaveBeenCalled());
    expect(showConfirm).toHaveBeenCalledWith(
      'Link Alice and Bob Jones to their Person notes? Zed stays as text.',
      'link-property-names',
      'Link',
    );
    expect(lastRewrite(onContentChange)).toBe(meetingNote(
      'attendees:\n  - "[[Alice]]"\n  - "[[p-002|Bob Jones]]"\n  - Zed',
    ));
  });

  it('writes nothing when the confirm is cancelled', async () => {
    showConfirm.mockResolvedValue(false);
    const onContentChange = vi.fn();
    render(PropertiesPanel, typedProps({ content: meetingNote('attendees: Alice'), onContentChange }));
    await fireEvent.click(await screen.findByRole('button', { name: 'Link attendees' }));
    await waitFor(() => expect(showConfirm).toHaveBeenCalled());
    expect(onContentChange).not.toHaveBeenCalled();
  });

  it('keeps a CRLF note CRLF', async () => {
    showConfirm.mockResolvedValue(true);
    const onContentChange = vi.fn();
    render(PropertiesPanel, typedProps({ content: meetingNote('attendees:\r\n  - Alice\r\n  - Zed', '\r\n'), onContentChange }));
    await fireEvent.click(await screen.findByRole('button', { name: 'Link attendees' }));
    await waitFor(() => expect(onContentChange).toHaveBeenCalled());
    expect(lastRewrite(onContentChange)).toBe(meetingNote('attendees:\r\n  - "[[Alice]]"\r\n  - Zed', '\r\n'));
  });

  it('is not offered when no name matches, or the value is already a link', async () => {
    const { unmount } = render(PropertiesPanel, typedProps({ content: meetingNote('attendees: Zed, Yan') }));
    await waitFor(() => expect(h.api.types.instances).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('button', { name: 'Link attendees' })).toBeNull();
    unmount();

    render(PropertiesPanel, typedProps({ content: meetingNote('attendees: "[[Alice]]"') }));
    await waitFor(() => expect(screen.getByText('Meeting')).toBeTruthy());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('button', { name: 'Link attendees' })).toBeNull();
  });

  it('is offered per link property — the organizer too', async () => {
    render(PropertiesPanel, typedProps({ content: meetingNote('organizer: Alice') }));
    expect(await screen.findByRole('button', { name: 'Link organizer' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Link attendees' })).toBeNull();
  });
});
