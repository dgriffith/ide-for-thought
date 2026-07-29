/**
 * @vitest-environment happy-dom
 *
 * Render + interaction coverage for the format-first export dialog
 * (ExportDialog, #export-menu-redesign). The dialog is a knot of runes: a
 * mount `$effect` that loads the launched format family from
 * `api.publish.listExporters`, `$derived` scope/variant resolution, and a
 * re-resolving `$effect` that calls `api.publish.resolvePlan` whenever any
 * plan input (scope, variant, depth, link policy, overrides, deselections)
 * changes.
 *
 * These tests drive the real component against a mocked
 * `api.publish` boundary and assert the visible DOM (scope radios, variant
 * picker, Including/Excluded/Citations audit) plus the calls that reach the
 * IPC layer (resolvePlan args, runExport args, onExported/onCancel callbacks).
 * Nothing in the component logic is stubbed — the derived scope filtering and
 * override/deselection set plumbing run for real.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import type { ExporterInfo, ExportPreviewPlan } from '../../../src/renderer/lib/ipc/client';

const { listExportersMock, resolvePlanMock, runExportMock } = vi.hoisted(() => ({
  listExportersMock: vi.fn(),
  resolvePlanMock: vi.fn(),
  runExportMock: vi.fn(),
}));

// Mocking the client module also covers the publish store — it imports `api`
// from this same module, so `publish.runExport` funnels into runExportMock.
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: {
    publish: {
      listExporters: listExportersMock,
      resolvePlan: resolvePlanMock,
      runExport: runExportMock,
    },
  },
}));

import ExportDialog from '../../../src/renderer/lib/components/ExportDialog.svelte';

const GROUP = {
  id: 'markdown' as const,
  label: 'Markdown',
  category: 'document' as const,
  order: 0,
};

// Two exporters in the same family that both accept every scope, so the
// variant picker (scopeCandidates.length > 1) always renders.
function makeExporters(): ExporterInfo[] {
  return [
    {
      id: 'md-clean',
      label: 'Markdown (Cleaned)',
      acceptedKinds: ['single-note', 'folder', 'tree', 'project'],
      group: GROUP,
      variantLabel: 'Cleaned',
      variantOrder: 0,
    },
    {
      id: 'md-verbatim',
      label: 'Markdown (Verbatim)',
      acceptedKinds: ['single-note', 'folder', 'tree', 'project'],
      group: GROUP,
      variantLabel: 'Verbatim',
      variantOrder: 1,
    },
    // A different family that must be filtered out by the group id.
    {
      id: 'html-basic',
      label: 'HTML',
      acceptedKinds: ['project'],
      group: { id: 'html', label: 'HTML', category: 'document', order: 1 },
      variantOrder: 0,
    },
  ];
}

function makePlan(over: Partial<ExportPreviewPlan> = {}): ExportPreviewPlan {
  return {
    exporterId: 'md-clean',
    exporterLabel: 'Markdown (Cleaned)',
    inputs: [
      { relativePath: 'notes/a.md', kind: 'note', title: 'Note A', overridden: false },
      { relativePath: 'notes/b.md', kind: 'note', title: 'Note B', overridden: true },
    ],
    excluded: [
      { relativePath: 'private/secret.md', reason: 'private' },
      { relativePath: 'notes/dropped.md', reason: 'manually excluded' },
    ],
    citations: {
      availableStyles: [
        { id: 'apa', label: 'APA' },
        { id: 'mla', label: 'MLA' },
      ],
      availableLocales: [
        { id: 'en-US', label: 'English (US)' },
        { id: 'fr-FR', label: 'French' },
      ],
      bySource: [{ sourceId: 'src-1', title: 'Source One', refCount: 2 }],
      missing: [{ id: 'ghost', kind: 'cite', refCount: 1 }],
    },
    ...over,
  };
}

beforeEach(() => {
  listExportersMock.mockReset().mockResolvedValue(makeExporters());
  resolvePlanMock.mockReset().mockResolvedValue(makePlan());
  runExportMock.mockReset().mockResolvedValue({
    filesWritten: 2,
    summary: 'Exported 2 notes',
    outputDir: '/out',
    writtenPaths: ['/out/a.md', '/out/b.md'],
  });
});

afterEach(cleanup);

function renderDialog(over: {
  group?: string;
  activeFilePath?: string | null;
  activeSourceId?: string | null;
  onCancel?: () => void;
  onExported?: (r: {
    filesWritten: number;
    summary: string;
    outputDir: string;
    writtenPaths: string[];
  }) => void;
} = {}) {
  const onCancel = over.onCancel ?? vi.fn();
  const onExported = over.onExported ?? vi.fn();
  const utils = render(ExportDialog, {
    group: over.group ?? 'markdown',
    activeFilePath: over.activeFilePath ?? 'notes/current.md',
    activeSourceId: over.activeSourceId ?? null,
    onCancel,
    onExported,
  });
  return { ...utils, onCancel, onExported };
}

/** The most recent resolvePlan call's [input, opts] args. */
function lastResolveCall() {
  return resolvePlanMock.mock.calls[resolvePlanMock.mock.calls.length - 1];
}

describe('ExportDialog — render + interaction (#export-menu-redesign)', () => {
  it('loads the launched family and renders scope radios + variant picker', async () => {
    const { container, findByText } = renderDialog();

    // Title reads the family label off the first group exporter.
    expect(await findByText('Export as Markdown')).toBeTruthy();

    await waitFor(() => expect(listExportersMock).toHaveBeenCalled());

    // Every scope the family accepts, given a note is open, is offered.
    const scopeValues = [...container.querySelectorAll('input[name="scope"]')].map(
      (el) => (el as HTMLInputElement).value,
    );
    expect(scopeValues).toEqual(['single-note', 'folder', 'tree', 'project']);

    // Two markdown variants → variant picker renders (html-basic filtered out).
    expect(await findByText('Cleaned')).toBeTruthy();
    expect(await findByText('Verbatim')).toBeTruthy();
  });

  it('resolves a plan on mount and renders the Including / Excluded / Citations audit', async () => {
    const { findByText, getByText } = renderDialog();

    // Default scope is 'project' (initial state is in availableScopes).
    await waitFor(() => expect(resolvePlanMock).toHaveBeenCalled());
    expect(lastResolveCall()[0]).toEqual({ kind: 'project' });

    // Including list.
    expect(await findByText('Note A')).toBeTruthy();
    expect(getByText('Note B')).toBeTruthy();
    // Excluded list with reasons.
    expect(getByText('private/secret.md')).toBeTruthy();
    expect(getByText('private')).toBeTruthy();
    // Citations audit (bySource + missing).
    expect(getByText('Source One')).toBeTruthy();
    expect(getByText(/missing cite: ghost/)).toBeTruthy();
  });

  it('changing scope to Linked notes reveals the depth control and re-resolves as a tree', async () => {
    const { container, findByText } = renderDialog({ activeFilePath: 'notes/current.md' });

    await findByText('Note A'); // wait for first resolve

    const treeRadio = container.querySelector('input[name="scope"][value="tree"]')!;
    await fireEvent.click(treeRadio);

    // Depth <select> now renders.
    await findByText(/how far to follow links out/);

    await waitFor(() => {
      const [input] = lastResolveCall();
      expect(input).toEqual({ kind: 'tree', relativePath: 'notes/current.md', maxDepth: 3 });
    });
  });

  it('unchecking an Including row force-excludes it in the next resolvePlan', async () => {
    const { container, findByText } = renderDialog();

    await findByText('Note A');
    resolvePlanMock.mockClear();

    // First Including-row checkbox → toggleDeselection('notes/a.md').
    const rowCheck = container.querySelector('.audit-section .row-check') as HTMLInputElement;
    await fireEvent.click(rowCheck);

    await waitFor(() => {
      const [, opts] = lastResolveCall();
      expect(opts.forceExclude).toContain('notes/a.md');
    });
  });

  it('clicking a privately-excluded row force-includes it (override) on re-resolve', async () => {
    const { getByText, findByText } = renderDialog();

    await findByText('Note A');
    resolvePlanMock.mockClear();

    // 'private/secret.md' has reason 'private' → toggleOverride → forceInclude.
    await fireEvent.click(getByText('private/secret.md'));

    await waitFor(() => {
      const [, opts] = lastResolveCall();
      expect(opts.forceInclude).toContain('private/secret.md');
    });
  });

  it('Cancel button invokes onCancel and does not export', async () => {
    const { getByText, findByText, onCancel } = renderDialog();
    await findByText('Note A');

    await fireEvent.click(getByText('Cancel'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(runExportMock).not.toHaveBeenCalled();
  });

  it('Export routes through the publish store with the resolved args and reports the result up', async () => {
    const { getByText, findByText, onExported } = renderDialog();
    await findByText('Note A');

    // Export button is enabled once a non-empty plan is resolved.
    const exportBtn = getByText('Export…').closest('button') as HTMLButtonElement;
    await waitFor(() => expect(exportBtn.disabled).toBe(false));

    await fireEvent.click(exportBtn);

    await waitFor(() => expect(runExportMock).toHaveBeenCalledTimes(1));
    expect(runExportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        exporterId: 'md-clean',
        input: { kind: 'project' },
        linkPolicy: 'inline-title',
        citationStyle: 'apa',
        citationLocale: 'en-US',
      }),
    );
    await waitFor(() =>
      expect(onExported).toHaveBeenCalledWith(
        expect.objectContaining({ filesWritten: 2, summary: 'Exported 2 notes' }),
      ),
    );
  });

  it('a cancelled directory picker (runExport → null) does not call onExported', async () => {
    runExportMock.mockResolvedValue(null);
    const { getByText, findByText, onExported } = renderDialog();
    await findByText('Note A');

    const exportBtn = getByText('Export…').closest('button') as HTMLButtonElement;
    await waitFor(() => expect(exportBtn.disabled).toBe(false));
    await fireEvent.click(exportBtn);

    await waitFor(() => expect(runExportMock).toHaveBeenCalledTimes(1));
    expect(onExported).not.toHaveBeenCalled();
  });

  it('a resolvePlan failure surfaces the error banner', async () => {
    resolvePlanMock.mockRejectedValue(new Error('boom while resolving'));
    const { findByText } = renderDialog();

    expect(await findByText('boom while resolving')).toBeTruthy();
  });

  it('offers only project + source scopes when no note is open but a source is active', async () => {
    // Family that accepts project + source; no note open, source tab active.
    listExportersMock.mockResolvedValue([
      {
        id: 'md-src',
        label: 'Markdown',
        acceptedKinds: ['project', 'source'],
        group: GROUP,
        variantOrder: 0,
      },
    ]);
    const { container, findByText } = renderDialog({
      activeFilePath: null,
      activeSourceId: 'src-42',
    });

    await findByText('Export as Markdown');

    await waitFor(() => {
      const scopeValues = [...container.querySelectorAll('input[name="scope"]')].map(
        (el) => (el as HTMLInputElement).value,
      );
      expect(scopeValues).toEqual(['project', 'source']);
    });
  });
});
