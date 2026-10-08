/**
 * Audio recordings kept as files in the thoughtbase (#2428).
 *
 * Dictation (`voice.svelte.ts`) throws the audio away once Whisper has turned
 * it into text. A recording keeps it: stopping writes the encoded audio to
 * `assets/recordings/` and embeds it in a note, where it renders as an inline
 * `<audio>` player (#908). Nothing is transcribed unless the user asks.
 * Transcribe decodes the file, cuts it into ~2-minute segments at pauses
 * (`segments.ts`), and runs each through the same local Whisper worker that
 * dictation uses, so the worker holds one segment at a time and nothing leaves
 * the machine. The transcript lands as paragraphs under the embed.
 *
 * Note edits go through the live editor when the note is the one on screen, so
 * they join its undo history and don't fight an unsaved buffer. Otherwise they
 * go through the file, and a note with unsaved edits in a background tab is
 * left alone rather than overwritten. File writes go through the notebase store
 * (renderer data-flow rule); the `api` calls here are reads.
 */

import type { EditorView } from '@codemirror/view';
import { api } from '../ipc/client';
import { getNotebaseStore } from '../stores/notebase.svelte';
import { getEditorStore } from '../stores/editor.svelte';
import { startRecording, decodeAudioFile, micErrorMessage, type RecordingSession } from './recorder';
import { getVoiceStore, sharedTranscriber } from './voice.svelte';
import { TARGET_SAMPLE_RATE } from './pcm';
import { planSegments } from './segments';
import {
  recordingExtension,
  recordingPath,
  recordingNoteTitle,
  embedInsertion,
  audioEmbedOnLine,
  findAudioEmbed,
  transcriptInsertion,
  joinSegments,
  decodeTarget,
} from './recording-text';
import { relativeAssetPathForNote } from '../editor/image-upload';
import { resolveRelativeImagePath } from '../preview/image-paths';
import { logger } from '../../../shared/logger';

export type RecordingStatus = 'idle' | 'starting' | 'recording' | 'saving';

/** A change to a note's text: insert `insert` at offset `at`. */
interface TextChange {
  at: number;
  insert: string;
}

/** Hands back the editor showing the active note, if there is one. */
export type ViewGetter = () => EditorView | null | undefined;

let status = $state<RecordingStatus>('idle');
let elapsedSec = $state(0);
let error = $state<string | null>(null);
/** The transcription in progress: which recording, and segments done/total. */
let transcription = $state<{ target: string; done: number; total: number } | null>(null);

let session: RecordingSession | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
/** The note that was active when recording started — where the embed goes. */
let startNote: string | null = null;
let startedAt = new Date();
let getView: ViewGetter = () => null;

function stopTicker(): void {
  if (ticker) clearInterval(ticker);
  ticker = null;
}

/** Start recording from the default microphone. */
async function start(viewGetter: ViewGetter): Promise<void> {
  if (status !== 'idle') return;
  if (getVoiceStore().busy) {
    error = 'Finish dictating before starting a recording.';
    return;
  }
  const editor = getEditorStore();
  getView = viewGetter;
  startNote = editor.activeNoteTab ? editor.activeFilePath : null;
  error = null;
  status = 'starting';
  let started: RecordingSession;
  try {
    started = await startRecording();
  } catch (e) {
    logger('voice').error('recording start failed:', e);
    error = micErrorMessage(e);
    status = 'idle';
    return;
  }
  // Cancelled while the mic permission prompt was up: release it at once.
  if (status !== 'starting') {
    started.cancel();
    return;
  }
  session = started;
  startedAt = new Date();
  elapsedSec = 0;
  ticker = setInterval(() => {
    elapsedSec = Math.floor((Date.now() - startedAt.getTime()) / 1000);
  }, 250);
  status = 'recording';
}

/** Stop recording, save the audio, and embed it in a note. */
async function stop(): Promise<void> {
  if (status !== 'recording' || !session) return;
  const s = session;
  session = null;
  stopTicker();
  status = 'saving';
  try {
    const blob = await s.stopBlob();
    if (blob.size === 0) {
      status = 'idle';
      return;
    }
    const assetPath = await freeRecordingPath(startedAt, recordingExtension(blob.type));
    try {
      await getNotebaseStore().writeBinary(assetPath, new Uint8Array(await blob.arrayBuffer()));
    } catch (e) {
      logger('voice').error('saving recording failed:', e);
      error = `Couldn't save the recording: ${messageOf(e)}`;
      return;
    }
    try {
      await embedRecording(assetPath);
    } catch (e) {
      logger('voice').error('embedding recording failed:', e);
      error = `Saved the recording as ${assetPath}, but couldn't add it to the note: ${messageOf(e)}`;
    }
  } catch (e) {
    logger('voice').error('stopping recording failed:', e);
    error = `Couldn't save the recording: ${messageOf(e)}`;
  } finally {
    status = 'idle';
  }
}

/** Abandon the recording: release the mic and save nothing. */
function cancel(): void {
  session?.cancel();
  session = null;
  stopTicker();
  if (status === 'recording' || status === 'starting') status = 'idle';
}

/** Start if idle, stop if recording — one command for the palette and menu. */
async function toggle(viewGetter: ViewGetter): Promise<void> {
  if (status === 'recording') await stop();
  else await start(viewGetter);
}

/** `recordingPath` for `at`, suffixed past any file already there. */
async function freeRecordingPath(at: Date, ext: string): Promise<string> {
  for (let n = 1; ; n++) {
    const candidate = recordingPath(at, ext, n === 1 ? undefined : n);
    if (!(await api.notebase.fileExists(candidate))) return candidate;
  }
}

/**
 * Put `![](…)` for `assetPath` into the note that was active when recording
 * started: at the cursor if it's still on screen, else appended. With no note
 * open, a new note is created to hold it.
 */
async function embedRecording(assetPath: string): Promise<void> {
  const editor = getEditorStore();
  if (startNote) {
    const embed = `![](${relativeAssetPathForNote(startNote, assetPath)})`;
    await editNote(startNote, (doc, cursor) => embedInsertion(doc, cursor ?? doc.length, embed));
    return;
  }
  const title = recordingNoteTitle(startedAt);
  let notePath = `${title}.md`;
  for (let n = 2; await api.notebase.fileExists(notePath); n++) notePath = `${title} ${n}.md`;
  await getNotebaseStore().writeFile(notePath, `# ${title}\n\n![](${assetPath})\n`);
  await editor.openFile(notePath);
}

/**
 * Apply `plan` to the note at `path`. Through the live editor when the note
 * is the one on screen (`plan` then also gets the cursor); otherwise through
 * the file. Returns false when `plan` found nothing to change. Throws rather
 * than overwrite unsaved edits in a background tab.
 */
async function editNote(
  path: string,
  plan: (doc: string, cursor: number | null) => TextChange | null,
): Promise<boolean> {
  const editor = getEditorStore();
  const view = getView();
  if (view && editor.activeFilePath === path && editor.viewMode !== 'preview') {
    const change = plan(view.state.doc.toString(), view.state.selection.main.head);
    if (!change) return false;
    view.dispatch({
      changes: { from: change.at, insert: change.insert },
      selection: { anchor: change.at + change.insert.length },
      scrollIntoView: true,
    });
    return true;
  }
  if (editor.isPathDirty(path)) {
    throw new Error(`“${path}” has unsaved changes. Save it, then try again.`);
  }
  const doc = await api.notebase.readFile(path);
  const change = plan(doc, null);
  if (!change) return false;
  await getNotebaseStore().writeFile(path, doc.slice(0, change.at) + change.insert + doc.slice(change.at));
  await editor.reloadTabFromDisk(path);
  return true;
}

/**
 * Transcribe the audio embed on the cursor's line in the active note (or on
 * the line at `pos`, for a right-click), and write the transcript beneath it.
 */
async function transcribeAtCursor(viewGetter: ViewGetter, pos?: number): Promise<void> {
  const editor = getEditorStore();
  const view = viewGetter();
  const notePath = editor.activeFilePath;
  if (!view || !notePath) return;
  const embed = audioEmbedOnLine(view.state.doc.toString(), pos ?? view.state.selection.main.head);
  if (!embed) {
    error = 'Put the cursor on the line with an audio recording to transcribe it.';
    return;
  }
  await transcribe(notePath, embed.target, viewGetter);
}

/**
 * The editor context menu's Transcribe Recording action for the line at
 * `pos`, or undefined when that line holds no audio embed. `pos` is bound
 * now, because the menu is closed (and its state cleared) before the action
 * runs.
 */
function transcribeActionAt(viewGetter: ViewGetter, pos: number | null): (() => void) | undefined {
  const view = viewGetter();
  if (!view || pos === null || !audioEmbedOnLine(view.state.doc.toString(), pos)) return undefined;
  return () => void transcribeAtCursor(viewGetter, pos);
}

/**
 * Transcribe the recording embedded as `target` in `notePath`, then put the
 * transcript under that embed (found again by its target, since the note may
 * have been edited while Whisper ran).
 */
async function transcribe(notePath: string, target: string, viewGetter: ViewGetter): Promise<void> {
  if (transcription) {
    error = 'A recording is already being transcribed.';
    return;
  }
  getView = viewGetter;
  error = null;
  transcription = { target, done: 0, total: 0 };
  try {
    const assetPath = resolveRelativeImagePath(decodeTarget(target), notePath);
    const bytes = await api.notebase.readBinary(assetPath);
    // decodeAudioData takes (and detaches) an ArrayBuffer of its own.
    let samples: Float32Array | null = await decodeAudioFile(bytes.slice().buffer);
    const ranges = planSegments(samples, TARGET_SAMPLE_RATE);
    transcription = { target, done: 0, total: ranges.length };
    const transcriber = sharedTranscriber();
    const texts: string[] = [];
    for (const [a, b] of ranges) {
      // `slice` copies just this segment, which is then transferred to the
      // worker; transferring a `subarray` would detach the whole recording.
      texts.push(await transcriber.transcribe(samples.slice(a, b)));
      transcription = { target, done: texts.length, total: ranges.length };
    }
    samples = null;
    const text = joinSegments(texts);
    if (!text) {
      error = 'No speech was recognised in that recording.';
      return;
    }
    const placed = await editNote(notePath, (doc) => {
      const found = findAudioEmbed(doc, target);
      return found ? transcriptInsertion(doc, found.end, text) : null;
    });
    if (!placed) error = 'The recording was removed from the note before its transcript was ready.';
  } catch (e) {
    logger('voice').error('transcription failed:', e);
    error = `Couldn't transcribe the recording: ${messageOf(e)}`;
  } finally {
    transcription = null;
  }
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function getAudioRecordingStore() {
  return {
    get status() {
      return status;
    },
    get recording() {
      return status === 'recording';
    },
    get elapsedSec() {
      return elapsedSec;
    },
    get error() {
      return error;
    },
    get transcription() {
      return transcription;
    },
    start,
    stop,
    cancel,
    toggle,
    transcribe,
    transcribeAtCursor,
    transcribeActionAt,
    clearError() {
      error = null;
    },
  };
}
