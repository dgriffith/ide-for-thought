/**
 * The audio-recording flows (#2428): where a stopped recording is saved and
 * embedded, and how a transcript is produced and placed. The mic, the
 * decoder, Whisper and the stores are mocked; the text logic is real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const files = new Map<string, string>();
  const binaries = new Map<string, Uint8Array>();
  const api = {
    app: { supportsSystemAudio: vi.fn(async () => true) },
    notebase: {
      fileExists: vi.fn(async (p: string) => files.has(p) || binaries.has(p)),
      readFile: vi.fn(async (p: string) => {
        const t = files.get(p);
        if (t === undefined) throw new Error(`ENOENT ${p}`);
        return t;
      }),
      readBinary: vi.fn(async (p: string) => {
        const b = binaries.get(p);
        if (!b) throw new Error(`ENOENT ${p}`);
        return b;
      }),
    },
  };
  const notebase = {
    writeBinary: vi.fn(async (p: string, b: Uint8Array) => { binaries.set(p, b); }),
    writeFile: vi.fn(async (p: string, t: string) => { files.set(p, t); }),
  };
  const editor = {
    activeFilePath: null as string | null,
    activeNoteTab: null as unknown,
    viewMode: 'source' as string,
    dirty: new Set<string>(),
    isPathDirty(p: string) { return this.dirty.has(p); },
    openFile: vi.fn(async () => {}),
    reloadTabFromDisk: vi.fn(async () => {}),
  };
  const session = { stopBlob: vi.fn(), stop: vi.fn(), cancel: vi.fn(), heardSystemAudio: vi.fn((): boolean | null => null) };
  const recorder = {
    startRecording: vi.fn(async () => session),
    decodeAudioFile: vi.fn(async (): Promise<Float32Array> => new Float32Array(0)),
  };
  const transcriber = { transcribe: vi.fn(async (pcm: Float32Array) => `segment of ${pcm.length}`) };
  const voice = { busy: false };
  return { files, binaries, api, notebase, editor, session, recorder, transcriber, voice };
});

vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));
vi.mock('../../../src/renderer/lib/stores/notebase.svelte', () => ({ getNotebaseStore: () => h.notebase }));
vi.mock('../../../src/renderer/lib/stores/editor.svelte', () => ({ getEditorStore: () => h.editor }));
vi.mock('../../../src/renderer/lib/voice/recorder', () => ({
  startRecording: h.recorder.startRecording,
  decodeAudioFile: h.recorder.decodeAudioFile,
  micErrorMessage: (e: unknown) => (e instanceof Error ? e.message : 'mic error'),
}));
vi.mock('../../../src/renderer/lib/voice/voice.svelte', () => ({
  getVoiceStore: () => h.voice,
  sharedTranscriber: () => h.transcriber,
}));

import { getAudioRecordingStore } from '../../../src/renderer/lib/voice/audio-recording.svelte';
import { silenceLogTags } from '../../helpers/quiet-logs';
import { mediaRecorderFile } from '../../helpers/webm-fixture';
import { readWebmDuration } from '../../../src/shared/webm-duration';

// The refusal and failure paths log under `voice` by design.
silenceLogTags('voice');

/** Just enough of a CodeMirror EditorView for the store: doc, cursor, dispatch. */
function fakeView(doc: string, cursor: number) {
  const view = {
    doc,
    cursor,
    state: {
      get doc() { return { toString: () => view.doc }; },
      get selection() { return { main: { head: view.cursor } }; },
    },
    dispatch: vi.fn((tr: { changes?: { from: number; insert: string } }) => {
      if (!tr.changes) return; // a selection-only transaction
      view.doc = view.doc.slice(0, tr.changes.from) + tr.changes.insert + view.doc.slice(tr.changes.from);
    }),
  };
  return view;
}

const rec = getAudioRecordingStore();

function openNote(path: string | null): void {
  h.editor.activeFilePath = path;
  h.editor.activeNoteTab = path ? { relativePath: path } : null;
}

async function recordOnce(
  view: ReturnType<typeof fakeView> | null,
  blob = new Blob(['opus'], { type: 'audio/webm;codecs=opus' }),
  opts: { systemAudio?: boolean } = {},
) {
  h.session.stopBlob.mockResolvedValueOnce(blob);
  await rec.start(() => view as never, opts);
  await rec.stop();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.files.clear();
  h.binaries.clear();
  h.editor.dirty.clear();
  h.editor.viewMode = 'source';
  h.voice.busy = false;
  openNote(null);
  rec.clearError();
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(new Date(2026, 9, 8, 14, 32));
});

describe('recording into a note', () => {
  it('saves the audio as a .weba file and embeds it at the cursor of the open note', async () => {
    openNote('meetings/standup.md');
    const view = fakeView('Notes:\n', 7);
    await recordOnce(view);

    expect(h.notebase.writeBinary).toHaveBeenCalledWith('assets/recordings/2026-10-08-1432.weba', expect.any(Uint8Array));
    // Note-relative, so the preview resolves it from meetings/.
    expect(view.doc).toBe('Notes:\n![](../assets/recordings/2026-10-08-1432.weba)');
    expect(rec.status).toBe('idle');
    expect(rec.error).toBeNull();
  });

  it('writes the recorded length into the saved WebM so the player can seek (#2728)', async () => {
    openNote('a.md');
    h.session.stopBlob.mockResolvedValueOnce(new Blob([mediaRecorderFile() as BlobPart], { type: 'audio/webm;codecs=opus' }));
    await rec.start(() => fakeView('', 0) as never);
    vi.advanceTimersByTime(42_000);
    await rec.stop();

    const saved = h.binaries.get('assets/recordings/2026-10-08-1432.weba')!;
    expect(readWebmDuration(saved)).toBeCloseTo(42_000, 6);
  });

  it('does not overwrite an earlier recording from the same minute', async () => {
    h.binaries.set('assets/recordings/2026-10-08-1432.weba', new Uint8Array([1]));
    openNote('a.md');
    await recordOnce(fakeView('', 0));
    expect(h.notebase.writeBinary).toHaveBeenCalledWith('assets/recordings/2026-10-08-1432-2.weba', expect.any(Uint8Array));
  });

  it('appends to the note through the file when it is no longer on screen', async () => {
    openNote('a.md');
    h.files.set('a.md', '# A\n');
    const view = fakeView('# A\n', 4);
    h.session.stopBlob.mockResolvedValueOnce(new Blob(['x'], { type: 'audio/webm' }));
    await rec.start(() => view as never);
    openNote('b.md'); // the user moved to another note while recording
    await rec.stop();

    expect(view.dispatch).not.toHaveBeenCalled();
    expect(h.files.get('a.md')).toBe('# A\n![](assets/recordings/2026-10-08-1432.weba)');
    expect(h.editor.reloadTabFromDisk).toHaveBeenCalledWith('a.md');
  });

  it('keeps the audio but leaves a note with unsaved edits alone, and says so', async () => {
    openNote('a.md');
    h.files.set('a.md', 'on disk');
    h.session.stopBlob.mockResolvedValueOnce(new Blob(['x'], { type: 'audio/webm' }));
    await rec.start(() => null);
    h.editor.dirty.add('a.md');
    openNote(null);
    await rec.stop();

    expect(h.binaries.has('assets/recordings/2026-10-08-1432.weba')).toBe(true);
    expect(h.files.get('a.md')).toBe('on disk');
    expect(rec.error).toMatch(/Saved the recording as assets\/recordings\/2026-10-08-1432\.weba.*unsaved changes/);
  });

  it('creates and opens a note to hold the recording when none was open', async () => {
    await recordOnce(null);
    expect(h.files.get('Recording 2026-10-08 14.32.md'))
      .toBe('# Recording 2026-10-08 14.32\n\n![](assets/recordings/2026-10-08-1432.weba)\n');
    expect(h.editor.openFile).toHaveBeenCalledWith('Recording 2026-10-08 14.32.md');
  });

  it('saves nothing for an empty capture, or when cancelled', async () => {
    openNote('a.md');
    await recordOnce(fakeView('', 0), new Blob([], { type: 'audio/webm' }));
    await rec.start(() => null);
    rec.cancel();
    expect(h.session.cancel).toHaveBeenCalled();
    expect(h.notebase.writeBinary).not.toHaveBeenCalled();
    expect(rec.status).toBe('idle');
  });

  it('refuses to start while dictation holds the mic', async () => {
    h.voice.busy = true;
    await rec.start(() => null);
    expect(h.recorder.startRecording).not.toHaveBeenCalled();
    expect(rec.error).toMatch(/dictating/);
  });

  it('counts elapsed time while recording', async () => {
    openNote('a.md');
    await rec.start(() => null);
    vi.advanceTimersByTime(65_000);
    expect(rec.elapsedSec).toBe(65);
    rec.cancel();
  });
});

describe('transcribing a recording', () => {
  const doc = 'Standup\n![](../assets/recordings/r.weba)\nAfter';

  it('transcribes the embed on the cursor line in segments and writes the transcript under it', async () => {
    openNote('meetings/standup.md');
    h.binaries.set('assets/recordings/r.weba', new Uint8Array([1, 2, 3]));
    // Five minutes at 16 kHz: planned as two segments.
    h.recorder.decodeAudioFile.mockResolvedValueOnce(new Float32Array(16_000 * 300));
    const view = fakeView(doc, doc.indexOf('![]') + 2);

    await rec.transcribeAtCursor(() => view as never);

    expect(h.api.notebase.readBinary).toHaveBeenCalledWith('assets/recordings/r.weba');
    expect(h.transcriber.transcribe).toHaveBeenCalledTimes(2);
    const lengths = h.transcriber.transcribe.mock.calls.map(([pcm]) => pcm.length);
    expect(lengths.reduce((a, b) => a + b, 0)).toBe(16_000 * 300);
    expect(view.doc).toBe(
      'Standup\n![](../assets/recordings/r.weba)\n\n> [!transcript]- Transcript\n'
      + `> segment of ${lengths[0]}\n>\n> segment of ${lengths[1]}\n\nAfter`,
    );
    expect(rec.transcription).toBeNull();
  });

  it('finds the embed again when the note changed while Whisper ran', async () => {
    openNote('meetings/standup.md');
    h.binaries.set('assets/recordings/r.weba', new Uint8Array([1]));
    h.recorder.decodeAudioFile.mockResolvedValueOnce(new Float32Array(16_000));
    const view = fakeView(doc, doc.indexOf('![]'));
    h.transcriber.transcribe.mockImplementationOnce(async () => {
      view.doc = `New first line\n${view.doc}`;
      return 'hello';
    });

    await rec.transcribeAtCursor(() => view as never);
    expect(view.doc).toBe('New first line\nStandup\n![](../assets/recordings/r.weba)\n\n> [!transcript]- Transcript\n> hello\n\nAfter');
  });

  it('says what to do when the cursor is not on a recording', async () => {
    openNote('a.md');
    await rec.transcribeAtCursor(() => fakeView('just text', 2) as never);
    expect(h.transcriber.transcribe).not.toHaveBeenCalled();
    expect(rec.error).toMatch(/Put the cursor on the line with an audio recording/);
  });

  it('reports silence instead of writing an empty transcript', async () => {
    openNote('meetings/standup.md');
    h.binaries.set('assets/recordings/r.weba', new Uint8Array([1]));
    h.recorder.decodeAudioFile.mockResolvedValueOnce(new Float32Array(16_000));
    h.transcriber.transcribe.mockResolvedValueOnce('  ');
    const view = fakeView(doc, doc.indexOf('![]'));
    await rec.transcribeAtCursor(() => view as never);
    expect(view.doc).toBe(doc);
    expect(rec.error).toMatch(/No speech/);
  });

  it('refuses a second transcript for the same recording', async () => {
    openNote('a.md');
    const transcribed = 'Standup\n![](r.weba)\n\n> [!transcript]- Transcript\n> hi';
    await rec.transcribeAtCursor(() => fakeView(transcribed, 10) as never);
    expect(h.api.notebase.readBinary).not.toHaveBeenCalled();
    expect(rec.error).toMatch(/already has a transcript/);
  });

  it('offers the context-menu action only on a line with an audio embed', () => {
    const view = fakeView(doc, 0);
    expect(rec.transcribeActionAt(() => view as never, doc.indexOf('![]'))).toBeTypeOf('function');
    expect(rec.transcribeActionAt(() => view as never, 0)).toBeUndefined();
    expect(rec.transcribeActionAt(() => view as never, null)).toBeUndefined();
    expect(rec.transcribeActionAt(() => null, 10)).toBeUndefined();
  });
});

describe('summarizing a recording (#2729)', () => {
  const transcribed = 'Standup\n![](r.weba)\n\n> [!transcript]- Transcript\n> We agreed to ship.\n\nAfter';
  const embedLine = transcribed.indexOf('![]');

  it('selects the embed and its transcript, then runs the summarize skill', () => {
    const view = fakeView(transcribed, 0);
    const invokeTool = vi.fn();
    const action = rec.summarizeActionAt(() => view as never, invokeTool, embedLine + 3)!;
    action();
    const sel = (view.dispatch.mock.calls[0]![0] as unknown as { selection: { anchor: number; head: number } }).selection;
    expect(transcribed.slice(sel.anchor, sel.head)).toBe('![](r.weba)\n\n> [!transcript]- Transcript\n> We agreed to ship.');
    expect(invokeTool).toHaveBeenCalledWith('analysis.summarize-recording');
  });

  it('offers Transcribe until there is a transcript, then Summarize', () => {
    const invokeTool = vi.fn();
    const bare = fakeView('![](r.weba)', 0);
    expect(rec.recordingMenuItemAt(() => bare as never, 2, invokeTool)?.label).toBe('Transcribe Recording');
    const done = fakeView(transcribed, 0);
    expect(rec.recordingMenuItemAt(() => done as never, embedLine, invokeTool)?.label).toBe('Summarize Recording…');
    expect(rec.recordingMenuItemAt(() => done as never, 0, invokeTool)).toBeUndefined();
  });

  it('from the palette, says to transcribe first when there is no transcript', () => {
    const invokeTool = vi.fn();
    rec.summarizeAtCursor(() => fakeView('![](r.weba)', 3) as never, invokeTool);
    expect(invokeTool).not.toHaveBeenCalled();
    expect(rec.error).toMatch(/Transcribe that recording first/);
    rec.summarizeAtCursor(() => fakeView('plain', 1) as never, invokeTool);
    expect(rec.error).toMatch(/Put the cursor on the line with an audio recording to summarize/);
  });
});

describe('meeting recordings: mic + system audio (#2731)', () => {
  it('asks the recorder for system audio and labels the recording a meeting', async () => {
    openNote('a.md');
    await rec.start(() => null, { systemAudio: true });
    expect(h.recorder.startRecording).toHaveBeenCalledWith({ systemAudio: true });
    expect(rec.meeting).toBe(true);
    rec.cancel();
  });

  it('refuses before touching the mic where the OS cannot capture system audio', async () => {
    h.api.app.supportsSystemAudio.mockResolvedValueOnce(false);
    await rec.start(() => null, { systemAudio: true });
    expect(h.recorder.startRecording).not.toHaveBeenCalled();
    expect(rec.error).toMatch(/macOS 14\.2/);
  });

  it('keeps the recording but says so when no system audio ever came through', async () => {
    openNote('a.md');
    h.session.heardSystemAudio.mockReturnValueOnce(false);
    await recordOnce(fakeView('', 0), undefined, { systemAudio: true });
    expect(h.binaries.has('assets/recordings/2026-10-08-1432.weba')).toBe(true);
    expect(rec.error).toMatch(/no system audio came through/);
  });

  it('is quiet when system audio was heard, and a plain recording never checks', async () => {
    openNote('a.md');
    h.session.heardSystemAudio.mockReturnValueOnce(true);
    await recordOnce(fakeView('', 0), undefined, { systemAudio: true });
    expect(rec.error).toBeNull();
    await recordOnce(fakeView('', 0));
    expect(rec.error).toBeNull();
    expect(rec.meeting).toBe(false);
  });
});
