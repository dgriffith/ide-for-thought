import os from 'node:os';
import path from 'node:path';

export function coinBaseUri(rootPath: string): string {
  const username = os.userInfo().username;
  const projectName = path.basename(rootPath);
  const safeName = (s: string) => encodeURIComponent(s.toLowerCase().replace(/\s+/g, '-'));
  return `https://project.minerva.dev/${safeName(username)}/${safeName(projectName)}/`;
}

export function noteUri(baseUri: string, relativePath: string): string {
  // Encode each path segment so spaces, commas, parens, etc. become a valid
  // IRI per RFC 3987. Encoding the whole string with encodeURIComponent
  // would also encode "/", which would erase the folder structure that
  // makes these IRIs human-readable. Segment-wise keeps slashes intact.
  const clean = relativePath.replace(/\.(md|ttl)$/, '');
  const encoded = clean.split('/').map(encodeURIComponent).join('/');
  return `${baseUri}note/${encoded}`;
}

export function tagUri(baseUri: string, tagName: string): string {
  return `${baseUri}tag/${encodeURIComponent(tagName)}`;
}

export function folderUri(baseUri: string, relativePath: string): string {
  // Same per-segment encoding rationale as noteUri — folder paths can carry
  // spaces or punctuation when the user organises notes into folders with
  // human-readable names.
  const encoded = relativePath.split('/').map(encodeURIComponent).join('/');
  return `${baseUri}folder/${encoded}`;
}

export function sourceUri(baseUri: string, sourceId: string): string {
  return `${baseUri}source/${encodeURIComponent(sourceId)}`;
}

export function excerptUri(baseUri: string, excerptId: string): string {
  return `${baseUri}excerpt/${encodeURIComponent(excerptId)}`;
}

export function tableUri(baseUri: string, tableName: string): string {
  return `${baseUri}table/${encodeURIComponent(tableName)}`;
}

export const SOURCES_DIR = '.minerva/sources';
export const EXCERPTS_DIR = '.minerva/excerpts';

export function projectUri(baseUri: string): string {
  return baseUri.replace(/\/$/, '');
}
