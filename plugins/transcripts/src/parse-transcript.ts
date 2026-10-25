/**
 * A subtitle or caption file (SubRip `.srt`, WebVTT `.vtt`) as a transcript
 * (#2647): the cues' text run together into paragraphs, each opening with the
 * time it starts at, so a passage can be cited by when it was said.
 *
 * A new paragraph starts when the speaker changes (a WebVTT `<v Name>` voice,
 * or a `NAME:` in capitals at the start of a cue), after a pause of `PAUSE_S` seconds, or
 * once a paragraph has run past `PARAGRAPH_CHARS` and a sentence ends. A line
 * repeated from the cue before is dropped: rolling captions repeat each line
 * as the next one arrives.
 */

/** A pause this long, in seconds, starts a new paragraph. */
export const PAUSE_S = 3;
/** Past this many characters, a paragraph ends with its next sentence. */
export const PARAGRAPH_CHARS = 600;

export interface Cue {
  start: number;
  end: number;
  speaker: string | null;
  text: string;
}

export interface Transcript {
  format: 'srt' | 'vtt';
  cues: Cue[];
  /** Markdown: one paragraph per passage, `**[h:mm:ss]**` first. */
  body: string;
}

const TIMING = /^\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3})/;

/** `01:02:03,456` / `02:03.456` → seconds. */
export function parseTimestamp(t: string): number {
  const [hms, ms = '0'] = t.replace(',', '.').split('.');
  const parts = hms!.split(':').map(Number);
  while (parts.length < 3) parts.unshift(0);
  const [h, m, s] = parts as [number, number, number];
  return h * 3600 + m * 60 + s + Number(`0.${ms}`);
}

/** Seconds → `h:mm:ss` (`m:ss` under an hour). */
export function formatTimestamp(seconds: number): string {
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', lrm: '', rlm: '' };

function decodeEntities(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** A cue's lines as plain text, and the speaker its markup names. */
function cueText(lines: string[]): { speaker: string | null; lines: string[] } {
  let speaker: string | null = null;
  const out: string[] = [];
  for (const raw of lines) {
    const voice = /<v(?:\.[^\s>]*)?\s+([^>]+)>/.exec(raw);
    if (voice && speaker === null) speaker = voice[1]!.trim();
    // Tags (<i>, <c.color>, <00:01.000>, {\an8}) go; their text stays.
    const line = decodeEntities(raw.replace(/<[^>]*>/g, '').replace(/\{\\[^}]*\}/g, '')).replace(/\s+/g, ' ').trim();
    if (line) out.push(line);
  }
  if (speaker === null && out.length > 0) {
    // Captions label a speaker in capitals: "JANE DOE: …", ">> JANE: …".
    const named = /^(?:>>\s*)?([A-Z][A-Z .'-]{1,40}):\s+(.*)$/.exec(out[0]!);
    if (named) {
      speaker = named[1]!.trim();
      out[0] = named[2]!;
    }
  }
  return { speaker, lines: out };
}

/** The cues in `text`, in order. */
export function parseCues(text: string): { format: 'srt' | 'vtt'; cues: Cue[] } {
  const normal = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const format = /^WEBVTT(?:[ \t].*)?$/m.test(normal.split('\n', 1)[0] ?? '') ? 'vtt' : 'srt';
  const cues: Cue[] = [];
  for (const block of normal.split(/\n[ \t]*\n/)) {
    const lines = block.split('\n');
    const at = lines.findIndex((l) => TIMING.test(l));
    if (at === -1) continue; // the WEBVTT header, a NOTE, STYLE or REGION block
    const m = TIMING.exec(lines[at]!)!;
    const { speaker, lines: textLines } = cueText(lines.slice(at + 1));
    if (textLines.length === 0) continue;
    cues.push({ start: parseTimestamp(m[1]!), end: parseTimestamp(m[2]!), speaker, text: textLines.join('\n') });
  }
  return { format, cues };
}

/** Parse a `.srt` or `.vtt` file's text into a transcript. */
export function parseTranscript(text: string): Transcript {
  const { format, cues } = parseCues(text);
  interface Paragraph { start: number; speaker: string | null; text: string }
  const paragraphs: Paragraph[] = [];
  let current = null as Paragraph | null;
  let lastEnd = -Infinity;
  let lastLine = '';
  for (const cue of cues) {
    const lines = cue.text.split('\n').filter((l) => l !== lastLine);
    if (lines.length === 0) { lastEnd = cue.end; continue; }
    lastLine = lines.at(-1)!;
    const speakerChanged = cue.speaker !== null && cue.speaker !== current?.speaker;
    const long = current !== null && current.text.length >= PARAGRAPH_CHARS && /[.!?]["')\]]?$/.test(current.text);
    if (!current || speakerChanged || cue.start - lastEnd >= PAUSE_S || long) {
      current = { start: cue.start, speaker: cue.speaker ?? current?.speaker ?? null, text: '' };
      paragraphs.push(current);
    }
    current.text = [current.text, ...lines].filter(Boolean).join(' ');
    lastEnd = cue.end;
  }
  // A speaker is named where they start talking, not on every paragraph of theirs.
  const body = paragraphs
    .map((p, i) => {
      const named = p.speaker !== null && p.speaker !== paragraphs[i - 1]?.speaker;
      return `**[${formatTimestamp(p.start)}]** ${named ? `*${p.speaker}:* ` : ''}${p.text}`;
    })
    .join('\n\n');
  return { format, cues, body: body ? `${body}\n` : '' };
}

/**
 * A title and language from a caption file's name: `keynote.en.vtt` →
 * "keynote", `en`. Dashes and underscores read as spaces.
 */
export function titleFromFilename(filename: string): { title: string; language?: string } {
  let stem = filename.replace(/\.(srt|vtt)$/i, '');
  let language: string | undefined;
  const lang = /\.([a-z]{2,3}(?:-[A-Za-z]{2,4})?)$/.exec(stem);
  if (lang) {
    language = lang[1]!;
    stem = stem.slice(0, -lang[0].length);
  }
  const title = stem.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || filename;
  return language ? { title, language } : { title };
}
