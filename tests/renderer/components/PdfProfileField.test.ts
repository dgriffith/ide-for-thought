/**
 * @vitest-environment happy-dom
 *
 * The export dialog's PDF style picker (#2429): the three profiles, the
 * chosen one's description beside it, and the choice bound back. The publish
 * store remembers it per thoughtbase.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';

vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: { publish: {} } }));

import PdfProfileField from '../../../src/renderer/lib/components/PdfProfileField.svelte';
import { getPublishStore } from '../../../src/renderer/lib/stores/publish.svelte';

afterEach(cleanup);
beforeEach(() => localStorage.clear());

describe('PdfProfileField (#2429)', () => {
  it('offers Notes, Essay and Academic, describing the chosen one', async () => {
    const { getByLabelText, getByText, findByText } = render(PdfProfileField, { props: { value: 'notes' } });
    const select = getByLabelText('Style') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['Notes', 'Essay', 'Academic']);
    expect(getByText('The page as it looks in Minerva.')).toBeTruthy();
    await fireEvent.change(select, { target: { value: 'academic' } });
    expect(await findByText(/two-column, with numbered headings/)).toBeTruthy();
    expect(select.getAttribute('aria-describedby')).toBe('pdf-profile-hint');
  });
});

describe('the remembered profile (#2429)', () => {
  const publish = getPublishStore();

  it('is per thoughtbase, and Notes until one is chosen', () => {
    expect(publish.pdfProfileFor('/a')).toBe('notes');
    publish.rememberPdfProfile('/a', 'essay');
    expect(publish.pdfProfileFor('/a')).toBe('essay');
    expect(publish.pdfProfileFor('/b')).toBe('notes');
  });

  it('a stored value that isn\'t a profile reads as Notes', () => {
    localStorage.setItem('export-pdf-profile:/a', 'memo');
    expect(publish.pdfProfileFor('/a')).toBe('notes');
  });
});
