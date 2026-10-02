/**
 * Callouts and highlights in exported pages (#2515): the preview's `.callout`
 * and `mark.hl-*` markup (now rendered by exports too, via the shared
 * markdown plugins) with a light palette mirroring the preview's colours.
 * Shared by the note/tree HTML and static-site stylesheets so the two can't
 * drift.
 */
export const EXPORT_CALLOUT_CSS = `
.callout { --callout-color: #8a5a1c; margin: 1em 0; padding: 0.6em 0.9em; border-left: 3px solid var(--callout-color); border-radius: 4px; background: color-mix(in srgb, var(--callout-color) 7%, transparent); page-break-inside: avoid; }
.callout-title { font-weight: 600; color: var(--callout-color); margin-bottom: 0.3em; }
details.callout > summary.callout-title { cursor: pointer; }
.callout-content > :first-child { margin-top: 0; }
.callout-content > :last-child { margin-bottom: 0; }
.callout-info, .callout-bug, .callout-example, .callout-abstract { --callout-color: #6c5cb8; }
.callout-tip, .callout-success { --callout-color: #4f7a5a; }
.callout-warning, .callout-failure, .callout-danger { --callout-color: #b4532a; }
.callout-quote { --callout-color: #777; }
.callout-card { --callout-color: #a07a16; }
mark.hl { background: #fbe9a6; color: inherit; padding: 0 0.1em; border-radius: 2px; }
mark.hl-yellow { background: #fbe9a6; }
mark.hl-green { background: #cfe8cf; }
mark.hl-blue { background: #cfe0f5; }
mark.hl-pink { background: #f6d3e0; }
mark.hl-orange { background: #f8dcc0; }
`;
