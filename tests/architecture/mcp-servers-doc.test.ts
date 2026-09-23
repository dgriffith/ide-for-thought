/**
 * @vitest-environment node
 *
 * `website/docs/_content/settings-mcp-servers.html` matches the code (#2259,
 * epic #2268).
 *
 * The page documents the MCP Servers settings tab — Minerva as an MCP
 * *client*, consuming third-party servers. Two of the things it tells a reader
 * are facts the code already owns, and both are exactly the shape that drifts
 * quietly: the set of transports you can configure, and the set of connection
 * states a row can be in. A new transport or a sixth status would ship with
 * the page still listing the old set, and nothing would say so — the page
 * would simply be wrong, confidently, in the one place a confused reader goes.
 *
 * Modeled on `config-roots-doc.test.ts`: the EXPECTED value is computed from
 * source under `src/`, the ACTUAL value is scraped from the document's own
 * markup, and every scrape asserts it matched something before comparing, so a
 * reworded page fails loudly rather than quietly checking nothing.
 *
 * ── What this does NOT check ────────────────────────────────────────────────
 * Presence and spelling, not accuracy: a status row whose description is wrong
 * still passes. Naming every state is the part that drifts. It also says
 * nothing about the prose around them, the screenshot, or the reverse
 * direction — a documented status the code doesn't have is caught, but a code
 * path the page merely under-explains is not.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const TYPES = 'src/shared/mcp-servers.ts';
const PANEL = 'src/renderer/lib/components/McpServersSettings.svelte';
const DIALOG = 'src/renderer/lib/components/SettingsDialog.svelte';
const DOC = 'website/docs/_content/settings-mcp-servers.html';
const SETTINGS_DOC = 'website/docs/_content/settings.html';
const CONNECTING_DOC = 'website/docs/_content/connecting-mcp.html';
const NAV = 'website/docs/_nav.json';
const DOC_PAGE = 'settings-mcp-servers.html';

const read = (f: string): string => readFileSync(f, 'utf-8');

/** The text of one `export type X = …` declaration, up to the next top-level
 *  `export` — which is what bounds it, since the union members themselves
 *  contain `;` inside their object literals. */
function declarationBody(src: string, name: string): string {
  const start = src.indexOf(`export type ${name}`);
  expect(start, `${name} is declared in ${TYPES}`).toBeGreaterThanOrEqual(0);
  const rest = src.slice(start + 1);
  const end = rest.indexOf('\nexport ');
  return end === -1 ? rest : rest.slice(0, end);
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

/** Inner text of every `<div class="k">…</div>` in the section introduced by
 *  `<h2 id="…">`, up to the next `<h2`. Tags are stripped; the key text is
 *  what the page shows the reader. */
function deflistKeys(doc: string, sectionId: string): string[] {
  const start = doc.indexOf(`<h2 id="${sectionId}">`);
  expect(start, `${DOC} has a <h2 id="${sectionId}"> section`).toBeGreaterThanOrEqual(0);
  const rest = doc.slice(start + 1);
  const end = rest.indexOf('<h2');
  const section = end === -1 ? rest : rest.slice(0, end);
  return [...section.matchAll(/<div class="k">([\s\S]*?)<\/div>/g)]
    .map((m) => m[1].replace(/<[^>]*>/g, '').trim());
}

describe('the MCP Servers doc page matches the code', () => {
  it('documents every configurable transport', () => {
    // Two independent readings of the same fact: the wire type's union, and
    // the radio buttons the settings form actually offers. They must agree —
    // which is also what keeps this from passing vacuously if either scrape
    // silently stops matching.
    const kinds = sorted(
      [...declarationBody(read(TYPES), 'McpServerDescriptor').matchAll(/kind:\s*'([^']+)'/g)].map((m) => m[1]),
    );
    const radios = sorted(
      [...read(PANEL).matchAll(/name="mcp-kind"\s+value="([^"]+)"/g)].map((m) => m[1]),
    );
    expect(kinds.length, `no transport kinds scraped from ${TYPES}`).toBeGreaterThan(0);
    expect(radios, 'the settings form offers exactly the transports the type declares').toEqual(kinds);

    const documented = sorted([...read(DOC).matchAll(/<code>([a-z]+)<\/code>/g)].map((m) => m[1]));
    for (const kind of kinds) {
      expect(documented, `${DOC} names the '${kind}' transport in a <code> span`).toContain(kind);
    }
  });

  it('documents every connection status, by the label the panel shows', () => {
    const statuses = sorted(
      [...declarationBody(read(TYPES), 'McpServerConnectionStatus').matchAll(/'([^']+)'/g)].map((m) => m[1]),
    );
    expect(statuses.length, `no statuses scraped from ${TYPES}`).toBeGreaterThan(0);

    // `statusLabel()` is what the reader actually sees on a row, so that — not
    // the union member's spelling — is what the page has to say.
    const panel = read(PANEL);
    const labels = new Map<string, string>(
      [...panel.matchAll(/case\s*'([^']+)':\s*return\s*'([^']*)'/g)].map((m) => [m[1], m[2]]),
    );
    const fallback = /default:\s*return\s*'([^']*)'/.exec(panel);
    expect(fallback, `${PANEL} has a statusLabel default arm`).not.toBeNull();
    const uncased = statuses.filter((s) => !labels.has(s));
    expect(uncased, 'exactly one status falls through statusLabel to the default arm').toHaveLength(1);
    labels.set(uncased[0], fallback![1]);

    const expected = sorted(statuses.map((s) => labels.get(s)!));
    expect(deflistKeys(read(DOC), 'status').sort()).toEqual(expected);
  });

  it('is reachable: named on the settings page, listed in the nav', () => {
    const tab = /\{\s*id:\s*'mcpServers',\s*label:\s*'([^']+)'/.exec(read(DIALOG));
    expect(tab, `${DIALOG} still declares the mcpServers tab`).not.toBeNull();
    expect(read(DOC), `${DOC}'s <h1> is the tab's own label`).toContain(`<h1>${tab![1]}</h1>`);
    // The glance table specifically, not just "linked somewhere on the page":
    // the settings index's one-row-per-tab list is the route a reader takes,
    // and the "In depth" card grid below it would otherwise satisfy a looser
    // assertion while the row a reader scans had gone missing.
    expect(read(SETTINGS_DOC), `${SETTINGS_DOC}'s glance table links the page`)
      .toContain(`<div class="k"><a href="${DOC_PAGE}">`);
    expect(read(NAV), `${NAV} lists the page`).toContain(`"${DOC_PAGE}"`);
  });

  it('cross-links the opposite direction, which is the confusion it exists to fix', () => {
    expect(read(DOC), `${DOC} points at connecting-mcp.html`).toContain('href="connecting-mcp.html"');
    expect(read(CONNECTING_DOC), `connecting-mcp.html points back at ${DOC_PAGE}`)
      .toContain(`href="${DOC_PAGE}"`);
  });
});
