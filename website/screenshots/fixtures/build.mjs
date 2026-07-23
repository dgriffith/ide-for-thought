// Generates short, mandolin-themed showcase notes for the docs screenshot
// harness. Each note is focused on ONE feature so the Preview crop is tight and
// clean. Run: node website/screenshots/fixtures/build.mjs
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'notes');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// id → note markdown. The H1 doubles as the note title the recipe opens.
const NOTES = {
  'links': `# The mandolin's relatives

The mandolin belongs to the lute family. Its closest cousins are the
[[The Mandolin Today]] and the deeper-voiced mandola, and its story begins with
the [[Ancient Roots - The Oud and the Lute Family]].

For the full lineage, see [[Mandolin Family Tree]].
`,

  'properties': `---
title: The Neapolitan Mandolin
tags: [mandolin, history, italy]
era: 1760s–present
family: lute
key_figures: [Pasquale Vinaccia]
status: reviewed
---

# The Neapolitan Mandolin

The bowl-backed Neapolitan is the instrument most people picture today. The
details above travel with the note wherever it goes.
`,

  'highlights': `# Reading notes — the Gibson revival

Orville Gibson's carved, arched tops were a ==green:genuine break== from the
bowl-backed tradition. Lloyd Loar's ==F-5== of 1922–24 became the
==yellow:most sought-after model in bluegrass==, and its tone bars are still
==orange:debated by luthiers== a century on.
`,

  'tasks': `# Practice plan

- [x] Learn the G-run in first position
- [x] Tremolo across two strings, slowly
- [ ] Cross-picking pattern (Monroe style)
- [ ] Memorise "Ashokan Farewell"
- [ ] Record a clean take of the chord melody
`,

  'callouts': `# Choosing a first mandolin

> [!tip] Start with an A-style
> A-style bodies cost less than the scrolled F-style and sound nearly identical.

> [!warning] Beware very cheap instruments
> Below a certain price the action is often too high to play in tune.

> [!note] Tuning
> A mandolin is tuned G–D–A–E, the same as a violin.
`,

  'footnotes': `# The 1892 Genoa competition

The Genoa competition of 1892 helped standardise the Neapolitan mandolin[^1] and
spurred the mandolin-orchestra movement across Europe[^2].

[^1]: Pasquale Vinaccia's extended fingerboard and metal strings had been
introduced a few decades earlier.
[^2]: Ensembles often paired first and second mandolins with mandola and
mandocello.
`,

  'math': `# The physics of a plucked string

A mandolin string's pitch follows the frequency of its fundamental:

$$f = \\frac{1}{2L}\\sqrt{\\frac{T}{\\mu}}$$

where $L$ is the vibrating length, $T$ the tension, and $\\mu$ the mass per unit
length. Halving $L$ at the twelfth fret raises the pitch by an octave.
`,

  'tables': `# Where the mandolin lives today

| Tradition | Role | Typical model |
|---|---|---|
| Bluegrass (USA) | Lead and rhythm | Gibson F-5 |
| Classical | Solo and chamber | Neapolitan bowl-back |
| Choro (Brazil) | Melodic voice | Flat-back bandolim |
| Celtic / folk | Melody and drones | A-style |
`,

  'diagrams': `# The lute family at a glance

\`\`\`mermaid
flowchart TD
  Oud["Oud · Near East"] --> Lute["European lute"]
  Lute --> Mandola["Mandola"]
  Mandola --> Neapolitan["Neapolitan mandolin"]
  Neapolitan --> Gibson["Gibson F-5"]
\`\`\`
`,

  'charts': `# Mandolin orchestras founded, by decade

\`\`\`vega-lite
{
  "height": 260,
  "data": {"values": [
    {"decade": "1880s", "orchestras": 12},
    {"decade": "1890s", "orchestras": 41},
    {"decade": "1900s", "orchestras": 78},
    {"decade": "1910s", "orchestras": 64},
    {"decade": "1920s", "orchestras": 33}
  ]},
  "mark": "bar",
  "encoding": {
    "x": {"field": "decade", "type": "ordinal", "title": "Decade"},
    "y": {"field": "orchestras", "type": "quantitative", "title": "Orchestras founded"}
  }
}
\`\`\`
`,

  'code': `# String tension at pitch

\`\`\`python
# Tension (N) for a steel E string tuned to 659.3 Hz
L = 0.34      # vibrating length (m)
mu = 3.9e-4   # mass per unit length (kg/m)
f = 659.3
T = mu * (2 * L * f) ** 2
print(f"{T:.1f} N")
\`\`\`
`,

  'rdf': `# Lloyd Loar

Lloyd Loar signed the finest Gibson F-5 mandolins. The facts below are recorded
in a turtle cell so the knowledge base can reason over them.

\`\`\`turtle
this: a thought:Person ;
  thought:label "Lloyd Loar" ;
  minerva:relatesTo <https://project.minerva.dev/davegriffith/demo/Gibson-F5> .
\`\`\`
`,

  'query': `# Notes tagged "mandolin"

A live list, gathered from the knowledge base and refreshed on its own:

:::query-list
title: Tagged “mandolin”
limit: 8
---
PREFIX tag: <https://project.minerva.dev/davegriffith/demo/tag/>
SELECT ?title ?path WHERE {
  ?note minerva:hasTag tag:mandolin ;
        dc:title ?title ;
        minerva:relativePath ?path .
}
ORDER BY ?title
:::
`,

  'search': `# Related reading

Notes closest in meaning to this one, found automatically:

:::query-semantic
baroque mandolin construction and regional varieties
:::
`,
};

for (const [id, md] of Object.entries(NOTES)) {
  fs.writeFileSync(path.join(OUT, `${id}.md`), md);
}
console.log(`Wrote ${Object.keys(NOTES).length} showcase notes to ${OUT}`);
