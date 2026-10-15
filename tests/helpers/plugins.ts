/**
 * Write a plugin package for a test (#2632, #2633): `<dir>/<id>/plugin.json`
 * with the given `contributes`, plus the files.
 */
import fs from 'node:fs';
import path from 'node:path';

export function writePlugin(
  dir: string,
  id: string,
  contributes: Record<string, string[]>,
  files: Record<string, string> = {},
  extra: Record<string, unknown> = {},
): string {
  const root = path.join(dir, id);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'plugin.json'), JSON.stringify({
    id, name: extra.name ?? id, version: '1.0.0', minerva: '>=3.0.0', description: 'A test plugin.', contributes, ...extra,
  }));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

/** A minimal skill file. */
export const skillFile = (id: string, name: string, extra = '') =>
  `---\nid: ${id}\nname: ${name}\ndescription: A test skill\nmenu: Learning\noutputMode: openConversation\n${extra}---\nDo the thing.\n`;

/** A minimal type file. */
export const typeFile = (label: string, extra = '') => `---\nlabel: ${label}\n${extra}---\n`;
