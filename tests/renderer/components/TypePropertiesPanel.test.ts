/**
 * @vitest-environment happy-dom
 *
 * Typed-property form (#1066): renders the type's declared fields from the
 * #1063 read-back, seeds values from the live content, and writes edits back
 * through to the frontmatter. Untyped notes show no form.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/svelte';

const { notePropsMock } = vi.hoisted(() => ({ notePropsMock: vi.fn() }));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { types: { noteProperties: notePropsMock } },
}));

import TypePropertiesPanel from '../../../src/renderer/lib/components/right-sidebar/TypePropertiesPanel.svelte';

const BOOK = {
  type: { id: 'book', label: 'Book', classLocalName: 'Book', source: 'stock', icon: '📖', properties: [] },
  properties: [
    { name: 'author', type: 'text', label: 'Author', value: null },
    { name: 'rating', type: 'number', label: 'Rating', value: null },
    { name: 'status', type: 'enum', label: 'Status', options: ['to-read', 'reading', 'read'], value: null },
  ],
};

afterEach(() => { cleanup(); notePropsMock.mockReset(); });

describe('TypePropertiesPanel (#1066)', () => {
  it('renders declared fields seeded from the note content', async () => {
    notePropsMock.mockResolvedValue(BOOK);
    render(TypePropertiesPanel, {
      activeFilePath: 'Dune.md',
      content: '---\ntype: book\nauthor: Frank Herbert\nrating: 5\n---\n',
      onContentChange: vi.fn(),
      revision: 0,
    });
    await waitFor(() => expect(screen.getByDisplayValue('Frank Herbert')).toBeTruthy());
    expect(screen.getByDisplayValue('5').type).toBe('number');
  });

  it('editing a field writes the value through to the frontmatter', async () => {
    notePropsMock.mockResolvedValue(BOOK);
    const onContentChange = vi.fn();
    render(TypePropertiesPanel, {
      activeFilePath: 'Dune.md',
      content: '---\ntype: book\nauthor: Frank Herbert\n---\n# Dune\n',
      onContentChange,
      revision: 0,
    });
    const author = await screen.findByDisplayValue('Frank Herbert');
    await fireEvent.change(author, { target: { value: 'F. Herbert' } });
    expect(onContentChange).toHaveBeenCalledTimes(1);
    const next = onContentChange.mock.calls[0]![0] as string;
    expect(next).toContain('author: F. Herbert');
    expect(next).toContain('# Dune'); // body preserved
  });

  it('shows no form for an untyped note', async () => {
    notePropsMock.mockResolvedValue({ type: null, properties: [] });
    render(TypePropertiesPanel, { activeFilePath: 'Plain.md', content: '# Plain\n', onContentChange: vi.fn(), revision: 0 });
    await waitFor(() => expect(screen.getByText(/no type/i)).toBeTruthy());
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
