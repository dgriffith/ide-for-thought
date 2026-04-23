import os from 'node:os';
import path from 'node:path';

export function coinBaseUri(rootPath: string): string {
  const username = os.userInfo().username;
  const projectName = path.basename(rootPath);
  const safeName = (s: string) => encodeURIComponent(s.toLowerCase().replace(/\s+/g, '-'));
  return `https://project.minerva.dev/${safeName(username)}/${safeName(projectName)}/`;
}

export function noteUri(baseUri: string, relativePath: string): string {
  const clean = relativePath.replace(/\.(md|ttl)$/, '');
  return `${baseUri}note/${clean}`;
}

export function tagUri(baseUri: string, tagName: string): string {
  return `${baseUri}tag/${encodeURIComponent(tagName)}`;
}

export function folderUri(baseUri: string, relativePath: string): string {
  return `${baseUri}folder/${relativePath}`;
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
