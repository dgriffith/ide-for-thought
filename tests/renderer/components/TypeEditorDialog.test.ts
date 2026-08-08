/**
 * @vitest-environment happy-dom
 *
 * Type editor form (#1585): builds a full type from the form — properties with
 * enum options / link-to-type target / on-card flag, plus cover — saved through
 * the object-types store; editing carries the stable id.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/svelte';

const { saveMock, listMock, emojiPanelMock, platform } = vi.hoisted(() => ({
  saveMock: vi.fn(), listMock: vi.fn(), emojiPanelMock: vi.fn(),
  // Mutable so a test can render both the macOS and the non-macOS form.
  platform: { IS_MAC: true },
}));
vi.mock('../../../src/renderer/lib/stores/object-types.svelte', () => ({
  objectTypesStore: { save: saveMock },
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { types: { list: listMock }, shell: { showEmojiPanel: emojiPanelMock } },
}));
vi.mock('../../../src/renderer/lib/utils/platform', () => ({ get IS_MAC() { return platform.IS_MAC; } }));

import TypeEditorDialog from '../../../src/renderer/lib/components/TypeEditorDialog.svelte';
import { COLOR_SWATCHES } from '../../../src/shared/color-swatches';

beforeEach(() => {
  platform.IS_MAC = true;
  saveMock.mockResolvedValue({ id: 'book', filePath: '.minerva/types/book.md' });
  listMock.mockResolvedValue({ types: [{ id: 'person' }, { id: 'book' }], errors: [] });
  emojiPanelMock.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('TypeEditorDialog (#1585)', () => {
  it('creates a new type from the form — label + added properties', async () => {
    const onSaved = vi.fn();
    render(TypeEditorDialog, { initial: { label: '', properties: [] }, onSaved, onClose: vi.fn() });

    await fireEvent.input(screen.getByPlaceholderText('Book'), { target: { value: 'Reading' } });
    await fireEvent.click(screen.getByText('+ Add property'));
    await fireEvent.click(screen.getByText('+ Add property'));
    const names = screen.getAllByPlaceholderText('author');
    await fireEvent.input(names[0]!, { target: { value: 'rating' } });
    await fireEvent.input(names[1]!, { target: { value: 'status' } });
    // Blank-named rows are dropped on save (here both are named).

    await fireEvent.click(screen.getByText('Create'));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    const input = saveMock.mock.calls[0]![0];
    expect(input.label).toBe('Reading');
    expect(input.id).toBeUndefined(); // new type — id derived from label
    expect(input.properties).toEqual([
      { name: 'rating', type: 'text' },
      { name: 'status', type: 'text' },
    ]);
    expect(onSaved).toHaveBeenCalledWith('book');
  });

  it('carries the stable id + link-to-type target + card flag when editing', async () => {
    render(TypeEditorDialog, {
      initial: { id: 'book', label: 'Book', properties: [{ name: 'author', type: 'link-to-type', targetType: 'person' }], card: ['author'] },
      onSaved: vi.fn(), onClose: vi.fn(),
    });
    await waitFor(() => expect(screen.getByDisplayValue('Book')).toBeTruthy());
    // The link-to-type target select should be pre-selected to person.
    await fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    const input = saveMock.mock.calls[0]![0];
    expect(input.id).toBe('book');
    expect(input.properties).toEqual([{ name: 'author', type: 'link-to-type', targetType: 'person' }]);
    expect(input.card).toEqual(['author']); // the on-card checkbox stayed set
  });

  it('preserves an explicit per-property label, without materializing defaults (#1594)', async () => {
    render(TypeEditorDialog, {
      initial: {
        id: 'book', label: 'Book',
        properties: [
          { name: 'author', type: 'text', label: 'Auteur' },          // real custom label — keep
          { name: 'page_count', type: 'number', label: 'Page Count' }, // == title-cased default — drop
        ],
      },
      onSaved: vi.fn(), onClose: vi.fn(),
    });
    await waitFor(() => expect(screen.getByDisplayValue('Book')).toBeTruthy());
    await fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(saveMock.mock.calls[0]![0].properties).toEqual([
      { name: 'author', type: 'text', label: 'Auteur' },
      { name: 'page_count', type: 'number' }, // default label not written back
    ]);
  });

  it('carries the parent type through save (#1587)', async () => {
    render(TypeEditorDialog, {
      initial: { id: 'monograph', label: 'Monograph', parent: 'book', properties: [] },
      onSaved: vi.fn(), onClose: vi.fn(),
    });
    // Wait for the type list to load (populates the parent dropdown).
    await waitFor(() => expect(document.querySelector('option[value="book"]')).toBeTruthy());
    await fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(saveMock.mock.calls[0]![0].parent).toBe('book');
  });

  it('reorders properties', async () => {
    render(TypeEditorDialog, {
      initial: { label: 'T', properties: [{ name: 'first', type: 'text' }, { name: 'second', type: 'text' }] },
      onSaved: vi.fn(), onClose: vi.fn(),
    });
    await waitFor(() => expect(screen.getByDisplayValue('first')).toBeTruthy());
    await fireEvent.click(screen.getAllByLabelText('Move down')[0]!); // move 'first' below 'second'
    await fireEvent.click(screen.getByText('Create'));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(saveMock.mock.calls[0]![0].properties.map((p: { name: string }) => p.name)).toEqual(['second', 'first']);
  });

  it('refuses to save without a name', async () => {
    render(TypeEditorDialog, { initial: { label: '', properties: [] }, onSaved: vi.fn(), onClose: vi.fn() });
    // The Create button is disabled with an empty name.
    expect(screen.getByText('Create').hasAttribute('disabled')).toBe(true);
    expect(saveMock).not.toHaveBeenCalled();
  });
});

describe('TypeEditorDialog — stock types keep their name', () => {
  // The Type Manager offers no Rename for a stock type, so an editable Name in
  // the dialog contradicted it. (They also meant different things: Rename
  // changes the id, the Name field changes the label.)

  it('locks the Name when editing a stock type, and says why', async () => {
    render(TypeEditorDialog, {
      initial: { id: 'book', label: 'Book', properties: [], stockOrigin: 'stock' },
      onSaved: vi.fn(), onClose: vi.fn(),
    });
    const name = screen.getByDisplayValue('Book');
    expect(name.readOnly).toBe(true);
    expect(screen.getByText(/is a stock type/)).toBeTruthy();
    expect(screen.getByText(/name is fixed/)).toBeTruthy();
  });

  it('locks the Name on an already-customized stock type too', async () => {
    // It's still stock-derived — the local copy doesn't make the name yours.
    render(TypeEditorDialog, {
      initial: { id: 'book', label: 'Book', properties: [], stockOrigin: 'customized' },
      onSaved: vi.fn(), onClose: vi.fn(),
    });
    expect((screen.getByDisplayValue('Book')).readOnly).toBe(true);
    // Already forked, so the "saving forks a copy" note is not repeated.
    expect(screen.queryByText(/is a stock type/)).toBeNull();
  });

  it('leaves the Name editable on a user type', async () => {
    render(TypeEditorDialog, {
      initial: { id: 'gadget', label: 'Gadget', properties: [] },
      onSaved: vi.fn(), onClose: vi.fn(),
    });
    expect((screen.getByDisplayValue('Gadget')).readOnly).toBe(false);
    expect(screen.queryByText(/is a stock type/)).toBeNull();
  });

  it('still saves the stock name through unchanged, alongside the real edits', async () => {
    // Locking the field must not drop the label from the payload — the local
    // copy needs it, since the override is a full definition.
    render(TypeEditorDialog, {
      initial: { id: 'book', label: 'Book', icon: '📖', properties: [{ name: 'author', type: 'text' }], stockOrigin: 'stock' },
      onSaved: vi.fn(), onClose: vi.fn(),
    });
    await fireEvent.click(screen.getByLabelText('Green'));
    await fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(saveMock.mock.calls[0]![0]).toMatchObject({ id: 'book', label: 'Book', color: '#a6e3a1' });
  });
});

describe('TypeEditorDialog — icon picker', () => {
  it('focuses and selects the icon field before raising the OS panel, so a pick replaces', async () => {
    // The native panel types into whatever field has focus. Without the
    // select(), picking would append a second glyph after the existing one.
    render(TypeEditorDialog, { initial: { label: 'Book', icon: '📖', properties: [] }, onSaved: vi.fn(), onClose: vi.fn() });
    const field = screen.getByDisplayValue('📖');
    const selectSpy = vi.spyOn(field, 'select');

    await fireEvent.click(screen.getByLabelText('Choose an emoji'));

    expect(document.activeElement).toBe(field);
    expect(selectSpy).toHaveBeenCalled();
    expect(emojiPanelMock).toHaveBeenCalled();
  });

  it('hides the picker button off macOS, leaving the field typable', async () => {
    // No cross-platform equivalent exists, so the plain text field is the
    // fallback rather than a button that would do nothing.
    platform.IS_MAC = false;
    render(TypeEditorDialog, { initial: { label: 'Book', icon: '📖', properties: [] }, onSaved: vi.fn(), onClose: vi.fn() });

    expect(screen.queryByLabelText('Choose an emoji')).toBeNull();
    expect(screen.getByDisplayValue('📖')).toBeTruthy();
  });

  it('accepts a multi-codepoint ZWJ emoji without truncating it', async () => {
    // 👨‍👩‍👧‍👦 is 11 UTF-16 units — the old maxlength of 4 cut it into mojibake.
    const family = '👨‍👩‍👧‍👦';
    render(TypeEditorDialog, { initial: { label: 'Family', properties: [] }, onSaved: vi.fn(), onClose: vi.fn() });
    await fireEvent.input(screen.getByPlaceholderText('📖'), { target: { value: family } });
    await fireEvent.click(screen.getByText('Create'));

    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(saveMock.mock.calls[0]![0].icon).toBe(family);
  });
});

describe('TypeEditorDialog — color picker', () => {
  it('keeps the presets on the same row as the well and hex field', async () => {
    // They used to be a full-width row of their own beneath Name/Icon/Color:
    // the swatches started at the left margin while the control they drive sat
    // at the far right, reading as though they belonged to Name. Structural,
    // because the whole point is the visual adjacency.
    const { container } = render(TypeEditorDialog, { initial: { label: 'Book', properties: [] }, onSaved: vi.fn(), onClose: vi.fn() });
    const row = container.querySelector('.color-row')!;
    expect(row).toBeTruthy();
    expect(row.querySelector('input[type="color"]')).toBeTruthy();
    expect(row.querySelector('input[placeholder="#89b4fa"]')).toBeTruthy();
    expect(row.querySelector('.swatches')).toBeTruthy();
    expect(row.querySelectorAll('.swatch')).toHaveLength(COLOR_SWATCHES.length);
  });

  it('sets the color from a preset swatch and saves it', async () => {
    render(TypeEditorDialog, { initial: { label: 'Book', properties: [] }, onSaved: vi.fn(), onClose: vi.fn() });
    await fireEvent.click(screen.getByLabelText('Green'));

    expect((screen.getByPlaceholderText('#89b4fa')).value).toBe('#a6e3a1');
    await fireEvent.click(screen.getByText('Create'));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(saveMock.mock.calls[0]![0].color).toBe('#a6e3a1');
  });

  it('marks the swatch matching the current color, matching case-insensitively', async () => {
    render(TypeEditorDialog, { initial: { label: 'Book', color: '#A6E3A1', properties: [] }, onSaved: vi.fn(), onClose: vi.fn() });
    expect(screen.getByLabelText('Green').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByLabelText('Blue').getAttribute('aria-pressed')).toBe('false');
  });

  it('drives the native color well, and holds its last good value while a hex is half-typed', async () => {
    const { container } = render(TypeEditorDialog, { initial: { label: 'Book', color: '#a6e3a1', properties: [] }, onSaved: vi.fn(), onClose: vi.fn() });
    const well = container.querySelector('input[type="color"]') as HTMLInputElement;
    expect(well.value).toBe('#a6e3a1');

    await fireEvent.input(screen.getByPlaceholderText('#89b4fa'), { target: { value: '#89b4f' } });
    expect(well.value).toBe('#89b4fa'); // the default, not a blank
  });

  it('clears the color, and omits it from the saved type', async () => {
    render(TypeEditorDialog, { initial: { label: 'Book', color: '#a6e3a1', properties: [] }, onSaved: vi.fn(), onClose: vi.fn() });
    await fireEvent.click(screen.getByLabelText('Clear color'));

    expect((screen.getByPlaceholderText('#89b4fa')).value).toBe('');
    await fireEvent.click(screen.getByText('Create'));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(saveMock.mock.calls[0]![0].color).toBeUndefined();
  });

  it('has no clear button when no color is set', async () => {
    render(TypeEditorDialog, { initial: { label: 'Book', properties: [] }, onSaved: vi.fn(), onClose: vi.fn() });
    expect(screen.queryByLabelText('Clear color')).toBeNull();
  });
});
