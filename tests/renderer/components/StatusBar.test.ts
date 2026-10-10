/**
 * @vitest-environment happy-dom
 *
 * The status bar's Record button (#2732): one click starts a recording, the
 * button turns into Stop with the elapsed time, and it's inert while the
 * recording is starting or being saved. The recording store is mocked; the
 * button reads it directly.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';

const h = vi.hoisted(() => {
  const rec: { status: string; recording: boolean; elapsedSec: number } = { status: 'idle', recording: false, elapsedSec: 0 };
  return { rec };
});

vi.mock('../../../src/renderer/lib/voice/audio-recording.svelte', () => ({
  getAudioRecordingStore: () => h.rec,
}));

import StatusBar from '../../../src/renderer/lib/components/StatusBar.svelte';

afterEach(() => {
  cleanup();
  Object.assign(h.rec, { status: 'idle', recording: false, elapsedSec: 0 });
});

function renderBar() {
  const onToggleRecording = vi.fn();
  const utils = render(StatusBar, {
    props: {
      cursor: { line: 1, column: 1, selectionLength: 0, wordCount: 0 },
      fontSize: 14,
      theme: 'dark',
      onGotoLine: vi.fn(),
      onSelectTheme: vi.fn(),
      onToggleDictation: vi.fn(),
      onToggleRecording,
    },
  });
  return { ...utils, onToggleRecording };
}

describe('status bar Record button (#2732)', () => {
  it('starts a recording with one click', async () => {
    const { getByRole, onToggleRecording } = renderBar();
    const btn = getByRole('button', { name: 'Record audio' });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    await fireEvent.click(btn);
    expect(onToggleRecording).toHaveBeenCalledTimes(1);
  });

  it('becomes Stop, showing the elapsed time, while recording', async () => {
    Object.assign(h.rec, { status: 'recording', recording: true, elapsedSec: 134 });
    const { getByRole, onToggleRecording } = renderBar();
    const btn = getByRole('button', { name: 'Stop recording' });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.textContent).toContain('2:14');
    await fireEvent.click(btn);
    expect(onToggleRecording).toHaveBeenCalledTimes(1);
  });

  it('is inert while a recording starts or saves', () => {
    for (const status of ['starting', 'saving']) {
      Object.assign(h.rec, { status });
      const { getByRole, unmount } = renderBar();
      expect((getByRole('button', { name: 'Record audio' }) as HTMLButtonElement).disabled).toBe(true);
      unmount();
    }
  });
});
