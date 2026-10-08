/**
 * Pure text helpers for audio recordings in notes (#2428): where a recording
 * is saved, how its embed goes into a note, how an embed is found again, and
 * where its transcript goes. No DOM and no editor, so all of it is unit-tested;
 * `audio-recording.svelte.ts` applies the results to a live editor or a file.
 */

import {
  RECORDINGS_DIR,
  TRANSCRIPT_HEADER,
  audioEmbedsIn,
  type AudioEmbed,
} from '../../../shared/audio-embeds';

export {
  RECORDINGS_DIR,
  audioEmbedsIn,
  decodeTarget,
  transcriptAfter,
  type AudioEmbed,
} from '../../../shared/audio-embeds';

/** File extension for a MediaRecorder MIME type. WebM gets `.weba` so it's
 *  classified as audio (`shared/media.ts`), not video. */
export function recordingExtension(mime: string): string {
  const base = mime.split(';')[0]!.trim().toLowerCase();
  if (base === 'audio/ogg') return 'ogg';
  if (base === 'audio/mp4') return 'm4a';
  return 'weba';
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** `assets/recordings/2026-10-08-1432.weba`, in local time. `suffix` (2, 3, …)
 *  disambiguates two recordings started in the same minute. */
export function recordingPath(at: Date, ext: string, suffix?: number): string {
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}`;
  return `${RECORDINGS_DIR}/${stamp}${suffix ? `-${suffix}` : ''}.${ext}`;
}

/** Title for a note created to hold a recording when no note was open. */
export function recordingNoteTitle(at: Date): string {
  return `Recording ${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}.${pad(at.getMinutes())}`;
}

/**
 * The change that puts `embed` at `pos` on a line of its own: a newline is
 * added before it unless `pos` already starts a line, and after it unless a
 * line break already follows.
 */
export function embedInsertion(doc: string, pos: number, embed: string): { at: number; insert: string } {
  const before = pos > 0 ? doc[pos - 1] : '\n';
  const after = pos < doc.length ? doc[pos] : '\n';
  return {
    at: pos,
    insert: `${before === '\n' ? '' : '\n'}${embed}${after === '\n' ? '' : '\n'}`,
  };
}

/**
 * The audio embed on the line containing `pos`, or null. With more than one
 * on the line, the first whose span reaches `pos`, else the line's first.
 */
export function audioEmbedOnLine(doc: string, pos: number): AudioEmbed | null {
  const lineStart = doc.lastIndexOf('\n', pos - 1) + 1;
  const nl = doc.indexOf('\n', pos);
  const lineEnd = nl === -1 ? doc.length : nl;
  const found = audioEmbedsIn(doc.slice(lineStart, lineEnd)).map((e) => ({
    target: e.target,
    end: e.end + lineStart,
  }));
  return found.find((e) => e.end >= pos) ?? found[0] ?? null;
}

/** The first audio embed of `target` in `doc` — how a transcript finds its
 *  recording again after the note was edited while it ran. */
export function findAudioEmbed(doc: string, target: string): AudioEmbed | null {
  return audioEmbedsIn(doc).find((e) => e.target === target) ?? null;
}

/**
 * A transcript as a default-collapsed callout (#2729):
 *
 *   > [!transcript]- Transcript
 *   > First paragraph.
 *   >
 *   > Second paragraph.
 *
 * Collapsed, so an hour of text doesn't push the rest of the note away; and
 * marked, so the summarize action and the graph can tell where it starts and
 * ends. The text is still plain markdown, so it stays editable and searchable.
 */
export function transcriptCallout(transcript: string): string {
  const body = transcript.split('\n').map((line) => (line.trim() ? `> ${line}` : '>'));
  return [TRANSCRIPT_HEADER, ...body].join('\n');
}

/**
 * The change that puts `transcript`, as a callout, just below the embed that
 * ends at `embedEnd`: after the rest of the embed's line, set off by a blank
 * line on each side.
 */
export function transcriptInsertion(
  doc: string,
  embedEnd: number,
  transcript: string,
): { at: number; insert: string } {
  const nl = doc.indexOf('\n', embedEnd);
  const at = nl === -1 ? doc.length : nl;
  // `rest` is empty or starts at a line break. Leave exactly one blank line
  // before whatever follows, and end the doc with a single newline.
  const rest = doc.slice(at);
  const tail = rest === '' ? '\n' : rest === '\n' || rest.startsWith('\n\n') ? '' : '\n';
  return { at, insert: `\n\n${transcriptCallout(transcript)}${tail}` };
}

/** Elapsed recording time as `m:ss`, or `h:mm:ss` from an hour. */
export function formatElapsed(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = String(totalSec % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Join per-segment transcripts: one paragraph per non-empty segment. */
export function joinSegments(texts: string[]): string {
  return texts.map((t) => t.trim()).filter(Boolean).join('\n\n');
}
