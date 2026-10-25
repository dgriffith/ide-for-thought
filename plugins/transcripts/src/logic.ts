/**
 * The Transcripts plugin's logic (#2647), run in its worker host (#2830):
 * the handler its ingestor names. It is handed a caption file's name and
 * bytes and returns a source draft; Minerva checks the draft and writes the
 * Source. It reads and writes nothing itself.
 */
import { connect } from '/@minerva/plugin-api.js';
import { parseTranscript, titleFromFilename } from './parse-transcript';

const minerva = await connect();

minerva.handle('parseTranscript', (args) => {
  const { filename, base64 } = args as { filename: string; base64: string };
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const transcript = parseTranscript(new TextDecoder('utf-8').decode(bytes));
  if (transcript.cues.length === 0) throw new Error(`${filename} has no captions in it.`);
  const { title, language } = titleFromFilename(filename);
  return {
    title,
    body: transcript.body,
    ...(language ? { language } : {}),
  };
});
