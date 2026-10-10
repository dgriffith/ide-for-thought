/**
 * Audio recordings embedded in a note → triples (#2730).
 *
 * For every `![](….weba|mp3|…)` audio embed in a note:
 *
 *   <note>  minerva:embeds          <recording> .
 *   <recording> a minerva:AudioRecording ;
 *           minerva:relativePath    "assets/recordings/2026-10-08-1432.weba" ;
 *           minerva:recordedAt      "2026-10-08T14:32:00"^^xsd:dateTime ;   # Minerva-named files
 *           minerva:durationSeconds 93.25 ;                                  # WebM with a Duration
 *           minerva:hasTranscript   true .                                   # transcript under this embed
 *
 * The recording's IRI is `noteUri` of its path, the same IRI a wiki-link to
 * the file resolves to (#1446), so `[[2026-10-08-1432.weba]]` and an embed
 * meet at one node. Everything goes in the embedding note's named graph, so
 * re-indexing or removing that note takes its recording triples with it. Two
 * notes embedding one file each assert the same type and path in their own
 * graph, which is harmless.
 *
 * Duration is read from the file's first 64 KB, enough for WebM's header,
 * so a long recording isn't read in full on every save. The path comes from a
 * note, which can come from someone else's thoughtbase, so it must resolve
 * inside the root (`isContainedPath`, symlinks included) or nothing is read.
 */

import * as $rdf from 'rdflib';
import fs from 'node:fs';
import path from 'node:path';
import { audioEmbedsIn, decodeTarget, recordingStartedAt, transcriptAfter } from '../../../shared/audio-embeds';
import { readWebmDuration } from '../../../shared/webm-duration';
import { isContainedPath } from '../../path-containment';
import { type GraphState, MINERVA, RDF, XSD, noteUri, dateLit } from '../state';

/** Bytes read to find a WebM `Duration`: the header sits in the first few hundred. */
const HEADER_BYTES = 64 * 1024;

export function indexNoteRecordings(
  state: GraphState,
  subject: $rdf.NamedNode,
  graph: $rdf.NamedNode,
  relativePath: string,
  content: string,
): void {
  const embeds = audioEmbedsIn(content);
  if (embeds.length === 0) return;
  const { store } = state;
  const seen = new Set<string>();
  for (const embed of embeds) {
    const assetPath = resolveFromNote(relativePath, decodeTarget(embed.target));
    if (!assetPath) continue;
    const recording = noteUri(state, assetPath);
    store.add(subject, MINERVA('embeds'), recording, graph);
    if (transcriptAfter(content, embed.end)) {
      store.add(recording, MINERVA('hasTranscript'), $rdf.lit('true', undefined, XSD('boolean')), graph);
    }
    if (seen.has(assetPath)) continue;
    seen.add(assetPath);

    store.add(recording, RDF('type'), MINERVA('AudioRecording'), graph);
    store.add(recording, MINERVA('relativePath'), $rdf.lit(assetPath), graph);
    const startedAt = recordingStartedAt(assetPath);
    if (startedAt) store.add(recording, MINERVA('recordedAt'), dateLit(startedAt), graph);
    const seconds = durationSeconds(state.rootPath, assetPath);
    if (seconds !== null) {
      store.add(recording, MINERVA('durationSeconds'), $rdf.lit(seconds.toFixed(2), undefined, XSD('decimal')), graph);
    }
  }
}

/** A note-relative embed target as a thoughtbase path, or null if it leaves
 *  the root or is a URL. */
function resolveFromNote(notePath: string, target: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/')) return null;
  const joined = path.posix.normalize(path.posix.join(path.posix.dirname(notePath), target));
  if (joined === '..' || joined.startsWith('../') || joined === '.') return null;
  return joined;
}

/** The recording's length from its WebM header, or null (missing file,
 *  outside the root, not WebM, no Duration). */
function durationSeconds(rootPath: string, assetPath: string): number | null {
  const abs = path.join(rootPath, assetPath);
  if (!isContainedPath(rootPath, abs)) return null;
  let fd: number | undefined;
  try {
    fd = fs.openSync(abs, 'r');
    const buf = Buffer.alloc(HEADER_BYTES);
    const n = fs.readSync(fd, buf, 0, HEADER_BYTES, 0);
    const ms = readWebmDuration(new Uint8Array(buf.buffer, buf.byteOffset, n));
    return ms === null ? null : ms / 1000;
  } catch (e) {
    // A file the filesystem refuses (missing — an embed typed before its file
    // exists — or unreadable) has no duration; that's the walkers' rule
    // (#2372). Anything without an errno code is a bug and surfaces.
    if (typeof (e as NodeJS.ErrnoException | null)?.code === 'string') return null;
    throw e;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
