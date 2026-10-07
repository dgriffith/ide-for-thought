/**
 * @vitest-environment happy-dom
 *
 * A `link-to-type` property holding plain text renders as that text (#2612).
 *
 * Meeting's `attendees` became Event's link-to-Person when Meeting became an
 * Event subtype, and existing meeting notes hold names (`attendees: Alice,
 * Bob`), not links. They aren't rewritten, so every surface that shows a
 * property value has to show the name as written: the type view's list,
 * table, gallery and kanban layouts (and the chromeless body every embed and
 * HTML export snapshots), the filter control, and the render card used for
 * link and hover cards. A real link still shows its note's name.
 *
 * The Properties panel's side of this is in PropertiesPanel.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, screen } from '@testing-library/svelte';

const { instancesMock, listMock, noteTypeMapMock } = vi.hoisted(() => ({
  instancesMock: vi.fn(), listMock: vi.fn(), noteTypeMapMock: vi.fn(),
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { types: { instances: instancesMock, list: listMock, noteTypeMap: noteTypeMapMock } },
}));
vi.mock('../../../src/renderer/lib/map/load-maplibre', () => ({
  loadMapLibre: vi.fn(() => new Promise(() => {})),
}));

import TypeView from '../../../src/renderer/lib/components/TypeView.svelte';
import { objectTypesStore } from '../../../src/renderer/lib/stores/object-types.svelte';
import { buildObjectCardHtml } from '../../../src/renderer/lib/preview/typed-card';
import { displayPropertyValue } from '../../../src/shared/objects/property-display';

const MEETING = {
  id: 'meeting',
  label: 'Meeting',
  classLocalName: 'Meeting',
  icon: '🗓️',
  source: 'stock' as const,
  properties: [
    { name: 'attendees', type: 'link-to-type' as const, targetType: 'person', label: 'Attendees' },
    { name: 'status', type: 'enum' as const, options: ['planned', 'held'], label: 'Status' },
  ],
};

const ALICE_IRI = 'https://project.minerva.dev/u/p/note/people/Alice%20Smith';
const INSTANCES = [
  { path: 'standup.md', title: 'Standup', values: { attendees: 'Alice, Bob', status: 'held' }, cover: null },
  { path: 'review.md', title: 'Review', values: { attendees: 'Carol / Dan', status: 'planned' }, cover: null },
  { path: 'kickoff.md', title: 'Kickoff', values: { attendees: ALICE_IRI, status: 'held' }, cover: null },
];

function props(over: Record<string, unknown> = {}) {
  return {
    typeId: 'meeting',
    layout: 'list' as const,
    sortColumn: null,
    sortDir: 'asc' as const,
    columns: null,
    revision: 0,
    onStateChange: vi.fn(),
    onOpenNote: vi.fn(),
    ...over,
  };
}

beforeEach(async () => {
  instancesMock.mockResolvedValue({ type: MEETING, instances: INSTANCES });
  listMock.mockResolvedValue({ types: [MEETING], errors: [] });
  noteTypeMapMock.mockResolvedValue({});
  await objectTypesStore.refresh();
});
afterEach(() => { cleanup(); instancesMock.mockReset(); });

describe('displayPropertyValue', () => {
  const link = MEETING.properties[0]!;
  it('shows a plain-text value on a link property exactly as written', () => {
    expect(displayPropertyValue(link, 'Alice, Bob')).toBe('Alice, Bob');
    expect(displayPropertyValue(link, 'Carol / Dan')).toBe('Carol / Dan');
    expect(displayPropertyValue(link, 'R&D #3')).toBe('R&D #3');
  });
  it("shows a linked note's IRI as the note's name", () => {
    expect(displayPropertyValue(link, ALICE_IRI)).toBe('Alice Smith');
  });
  it('shows an empty value as a dash', () => {
    expect(displayPropertyValue(link, null)).toBe('—');
    expect(displayPropertyValue(link, '')).toBe('—');
  });
});

describe('TypeView shows plain-text link values as text (#2612)', () => {
  it('list', async () => {
    render(TypeView, props({ layout: 'list' }));
    await waitFor(() => expect(screen.getByText('Standup')).toBeTruthy());
    expect(screen.getByText('Attendees: Alice, Bob')).toBeTruthy();
    expect(screen.getByText('Attendees: Carol / Dan')).toBeTruthy();
    expect(screen.getByText('Attendees: Alice Smith')).toBeTruthy();
  });

  it('table', async () => {
    render(TypeView, props({ layout: 'table' }));
    await waitFor(() => expect(screen.getByText('Standup')).toBeTruthy());
    const cells = [...document.querySelectorAll('td')].map((td) => td.textContent?.trim());
    expect(cells).toContain('Alice, Bob');
    expect(cells).toContain('Carol / Dan');
    expect(cells).toContain('Alice Smith');
  });

  it('gallery', async () => {
    render(TypeView, props({ layout: 'gallery' }));
    await waitFor(() => expect(screen.getByText('Standup')).toBeTruthy());
    expect(screen.getByText('Attendees: Alice, Bob')).toBeTruthy();
    expect(screen.getByText('Attendees: Carol / Dan')).toBeTruthy();
  });

  it('kanban cards', async () => {
    render(TypeView, props({ layout: 'kanban' }));
    await waitFor(() => expect(screen.getByText('Standup')).toBeTruthy());
    const vals = [...document.querySelectorAll('.kb-fval')].map((e) => e.textContent?.trim());
    expect(vals).toContain('Alice, Bob');
    expect(vals).toContain('Carol / Dan');
    expect(vals).toContain('Alice Smith');
  });

  it('chromeless — the body an embed and every HTML export render', async () => {
    render(TypeView, props({ layout: 'table', chromeless: true }));
    await waitFor(() => expect(screen.getByText('Standup')).toBeTruthy());
    const cells = [...document.querySelectorAll('td')].map((td) => td.textContent?.trim());
    expect(cells).toContain('Alice, Bob');
    expect(cells).toContain('Carol / Dan');
  });
});

describe('the render card (link and hover cards) shows a plain-text link value as text', () => {
  it('renders the names as a field chip', () => {
    const html = buildObjectCardHtml({
      type: MEETING,
      properties: [
        { ...MEETING.properties[0]!, value: 'Alice, Bob' },
        { ...MEETING.properties[1]!, value: 'held' },
      ],
    }, { title: 'Standup' });
    expect(html).toContain('<span class="oc-flabel">Attendees</span><span class="oc-fval">Alice, Bob</span>');
  });

  it("renders a linked value as the note's name, not its IRI", () => {
    const html = buildObjectCardHtml({
      type: MEETING,
      properties: [{ ...MEETING.properties[0]!, value: ALICE_IRI }],
    }, { title: 'Kickoff' });
    expect(html).toContain('<span class="oc-fval">Alice Smith</span>');
    expect(html).not.toContain('project.minerva.dev');
  });
});
