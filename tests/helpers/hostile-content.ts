/**
 * Hostile thoughtbase CONTENT with no test-runner dependency (#2557), so both
 * vitest suites (via `hostile-thoughtbase.ts`, which re-exports it) and the
 * Playwright e2e suite — which can't import vitest — can plant it.
 */
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
