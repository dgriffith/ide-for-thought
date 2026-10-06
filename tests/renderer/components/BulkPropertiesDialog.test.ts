/**
 * @vitest-environment happy-dom
 *
 * The "Edit properties…" panel (#2431): renders a selection's schema with the
 * Properties panel's widgets, shows "Mixed" where notes disagree, and resolves
 * with edits for the touched fields only.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/svelte';
import BulkPropertiesDialog from '../../../src/renderer/lib/components/BulkPropertiesDialog.svelte';
import { buildBulkFieldModel } from '../../../src/shared/objects/bulk-properties';
import type { TypeInfo } from '../../../src/shared/objects/type-def';

const TASK: TypeInfo = {
  id: 'task', label: 'Task', classLocalName: 'Task', source: 'user',
  properties: [
    { name: 'due', type: 'date', label: 'Due' },
    { name: 'done', type: 'boolean', label: 'Done' },
    { name: 'status', type: 'enum', label: 'Status', options: ['open', 'closed'] },
    { name: 'effort', type: 'number', label: 'Effort' },
  ],
};
const BUG: TypeInfo = { id: 'bug', label: 'Bug', classLocalName: 'Bug', source: 'user', properties: [{ name: 'due', type: 'date', label: 'Due' }] };

function model(notes: { fm: string; type?: TypeInfo }[]) {
  return buildBulkFieldModel(
    notes.map((n, i) => ({ path: `n${i}.md`, type: n.type ?? TASK, content: `---\n${n.fm}\n---\n` })),
    (t) => t.properties,
  );
}

afterEach(() => cleanup());

describe('BulkPropertiesDialog', () => {
  it('shows the shared type\'s schema with typed widgets and a Mixed placeholder', () => {
    render(BulkPropertiesDialog, {
      model: model([{ fm: 'type: task\neffort: 2\ndone: true' }, { fm: 'type: task\neffort: 3\ndone: true' }]),
      onConfirm: vi.fn(), onCancel: vi.fn(),
    });
    expect(screen.getByText('Edit properties of 2 notes')).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Due').type).toBe('date');
    expect(screen.getByLabelText<HTMLInputElement>('Effort').placeholder).toBe('Mixed');
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Done' }).checked).toBe(true);
    expect([...screen.getByLabelText<HTMLSelectElement>('Status').options].map((o) => o.value)).toEqual(['', 'open', 'closed']);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply to 2 notes' }).disabled).toBe(true);
  });

  it('mixed types show only the common properties', () => {
    render(BulkPropertiesDialog, {
      model: model([{ fm: 'type: task' }, { fm: 'type: bug', type: BUG }]),
      onConfirm: vi.fn(), onCancel: vi.fn(),
    });
    expect(screen.getByText(/Mixed types \(Task, Bug\)/)).toBeTruthy();
    expect(screen.getByLabelText('Due')).toBeTruthy();
    expect(screen.queryByLabelText('Effort')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Done' })).toBeNull();
    expect(screen.getByLabelText('Title')).toBeTruthy();
  });

  it('resolves with edits for exactly the touched fields', async () => {
    const onConfirm = vi.fn();
    render(BulkPropertiesDialog, {
      model: model([{ fm: 'type: task\ndone: false\ntags: [a]' }, { fm: 'type: task\ntags: [a, b]' }]),
      onConfirm, onCancel: vi.fn(),
    });
    await fireEvent.change(screen.getByLabelText('Due'), { target: { value: '2026-12-01' } });
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Done' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Remove b from 2 notes' }));
    const tagInput = screen.getByLabelText('Add to Tags');
    await fireEvent.input(tagInput, { target: { value: 'C' } });
    await fireEvent.keyDown(tagInput, { key: 'Enter' });
    await fireEvent.click(screen.getByRole('button', { name: 'Apply to 2 notes' }));
    expect(onConfirm).toHaveBeenCalledWith([
      { op: 'set', key: 'due', value: '2026-12-01' },
      { op: 'set', key: 'done', value: true },
      { op: 'list', key: 'tags', add: ['c'], remove: ['b'], style: 'tags' },
    ]);
  });

  it('Clear removes a field from every note; Revert un-touches it', async () => {
    const onConfirm = vi.fn();
    render(BulkPropertiesDialog, {
      model: model([{ fm: 'type: task\neffort: 2' }, { fm: 'type: task\neffort: 2\nlegacy: x' }]),
      onConfirm, onCancel: vi.fn(),
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Clear Effort' }));
    expect(screen.getByText('Removed from every note')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Revert Effort' }));
    expect(screen.queryByText('Removed from every note')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Remove legacy from 2 notes' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apply to 2 notes' }));
    expect(onConfirm).toHaveBeenCalledWith([{ op: 'clear', key: 'legacy' }]);
  });

  it('blocks Apply on a number that is not a number', async () => {
    render(BulkPropertiesDialog, { model: model([{ fm: 'type: task' }]), onConfirm: vi.fn(), onCancel: vi.fn() });
    await fireEvent.change(screen.getByRole('textbox', { name: 'New property name' }), { target: { value: 'n' } });
    await fireEvent.change(screen.getByLabelText('New property type'), { target: { value: 'number' } });
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Apply to 1 note' }).disabled).toBe(true);
  });

  it('Cancel resolves nothing', async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(BulkPropertiesDialog, { model: model([{ fm: 'type: task' }]), onConfirm, onCancel });
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
