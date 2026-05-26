// Left sidebar — Notes / Sites / Tags / Tables. Current vs proposed.

const { Surface, catVars } = window.MinervaBits;
const Icon = window.MinervaIcon;

// ── CURRENT ────────────────────────────────────────────────────────────

// Reproduces today's sidebar: panel-tab strip with Unicode glyphs, file tree
// with bare disclosure triangles + filename, no leading icons.
const CurrentLeftSidebar = ({ mode, panel = "notes" }) => {
  const tabs = [
    { id: "notes", glyph: "▤" },
    { id: "sites", glyph: "❡" },
    { id: "tags", glyph: "#" },
    { id: "tables", glyph: "⊞" },
  ];
  return (
    <Surface vars={catVars(mode)}>
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column",
                    background: "var(--bg-sidebar)", borderRight: "1px solid var(--border)" }}>
        <div style={{ display: "flex", gap: 2, padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
          {tabs.map((t) => (
            <button key={t.id} style={{
              padding: "4px 10px", border: "none", borderRadius: 4,
              background: t.id === panel ? "var(--bg-button-hover)" : "transparent",
              color: t.id === panel ? "var(--text)" : "var(--text-muted)",
              fontSize: 14, cursor: "pointer", fontFamily: "inherit",
            }}>{t.glyph}</button>
          ))}
        </div>

        {panel === "notes" && <CurrentNotesPanel />}
        {panel === "tags" && <CurrentTagsPanel />}
        {panel === "sites" && <CurrentSitesPanel />}
        {panel === "tables" && <CurrentTablesPanel />}
      </div>
    </Surface>
  );
};

const CurrentNotesPanel = () => (
  <>
    <div style={{ display: "flex", gap: 2, padding: "4px 8px", borderBottom: "1px solid var(--border)" }}>
      <button style={tinyBtn}>⬌</button>
      <button style={tinyBtn}>⬍</button>
      <button style={tinyBtn}>⦿</button>
    </div>
    <div style={{ padding: "4px 0", overflow: "hidden", flex: 1, fontSize: 13 }}>
      {/* root */}
      <button style={{ ...rowCurrent, fontWeight: 600, color: "var(--text)" }}>
        ▾ my-thoughts
      </button>
      <button style={rowCurrent}>▾ essays</button>
      <button style={{ ...rowCurrent, paddingLeft: 28, color: "var(--accent)", background: "var(--bg-button)" }}>
        on-the-trust-principle
      </button>
      <button style={{ ...rowCurrent, paddingLeft: 28 }}>epistemic-defects</button>
      <button style={{ ...rowCurrent, paddingLeft: 28 }}>how-autocomplete-should-feel</button>
      <button style={rowCurrent}>▸ ontology</button>
      <button style={rowCurrent}>▸ journal</button>
      <button style={rowCurrent}>▸ raft</button>
      <button style={rowCurrent}>README</button>
      <button style={rowCurrent}>index</button>
    </div>
  </>
);

const CurrentTagsPanel = () => (
  <div style={{ padding: "8px", overflow: "hidden", flex: 1, fontSize: 13 }}>
    {[
      ["#epistemology", 47],
      ["#draft", 23],
      ["#entrypoint", 8],
      ["#stale", 5],
      ["#claim", 89],
      ["#open-question", 14],
      ["#warrant", 31],
      ["#bias", 18],
      ["#fallacy", 12],
    ].map(([t, n]) => (
      <div key={t} style={{ display: "flex", justifyContent: "space-between", padding: "3px 6px", color: "var(--text)" }}>
        <span>{t}</span><span style={{ color: "var(--text-muted)", fontSize: 11 }}>{n}</span>
      </div>
    ))}
  </div>
);

const CurrentSitesPanel = () => (
  <div style={{ padding: "8px", overflow: "hidden", flex: 1, fontSize: 13 }}>
    {[
      "Plato — Republic",
      "Quine — Two Dogmas",
      "Toulmin — Uses of Argument",
      "Popper — Conjectures",
      "Kahneman — Thinking, Fast",
      "Sextus — Outlines",
    ].map((s) => (
      <div key={s} style={{ padding: "3px 6px", color: "var(--text)", borderBottom: "1px solid var(--border)" }}>
        {s}
      </div>
    ))}
  </div>
);

const CurrentTablesPanel = () => (
  <div style={{ padding: "8px", overflow: "hidden", flex: 1, fontSize: 13 }}>
    {[
      "claims_by_status",
      "warrants_by_strength",
      "sources_cited",
      "open_questions",
    ].map((s) => (
      <div key={s} style={{ padding: "3px 6px", color: "var(--text)", fontFamily: "ui-monospace, monospace", fontSize: 11.5 }}>
        {s}
      </div>
    ))}
  </div>
);

const rowCurrent = {
  display: "block", width: "100%", textAlign: "left",
  padding: "3px 8px", border: "none", background: "none",
  color: "var(--text)", fontSize: 13, cursor: "pointer", fontFamily: "inherit",
};
const tinyBtn = {
  border: "none", background: "none", color: "var(--text-muted)",
  fontSize: 12, padding: "2px 6px", borderRadius: 4, cursor: "pointer",
};

// ── PROPOSED ──────────────────────────────────────────────────────────

// Reimagined: labeled panel rail (icon + text label on active tab),
// per-panel header with a real H1 + count, file rows with note icons,
// proper folder iconography, breathing room, focused selection state.
const ProposedLeftSidebar = ({ vars, mode, panel = "notes" }) => {
  const tabs = [
    { id: "notes",  icon: "notes",  label: "Notes",  count: 184 },
    { id: "sites",  icon: "sites",  label: "Sites",  count: 27 },
    { id: "tags",   icon: "tags",   label: "Tags",   count: 63 },
    { id: "tables", icon: "tables", label: "Tables", count: 11 },
  ];
  return (
    <Surface vars={vars}>
      <div style={{
        width: "100%", height: "100%", display: "flex", flexDirection: "column",
        background: "var(--bg-elev)", borderRight: "1px solid var(--border)",
        fontFamily: "var(--font-sans)",
      }}>
        {/* the panel rail — active tab gets icon+label, inactive icon-only */}
        <div style={{ display: "flex", padding: "10px 10px 4px", gap: 2 }}>
          {tabs.map((t) => {
            const active = t.id === panel;
            return (
              <button key={t.id} style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: active ? "6px 10px" : "6px 8px",
                borderRadius: 7, border: "none",
                background: active ? "var(--bg)" : "transparent",
                color: active ? "var(--text)" : "var(--text-muted)",
                boxShadow: active ? "inset 0 0 0 1px var(--border)" : "none",
                fontSize: 12.5, fontWeight: active ? 500 : 450, cursor: "pointer",
                fontFamily: "inherit",
              }}>
                <Icon name={t.icon} size={14} color={active ? "var(--accent)" : "currentColor"} />
                {active && <span>{t.label}</span>}
              </button>
            );
          })}
        </div>

        {/* per-panel header with display-serif title + meta */}
        <div style={{ padding: "10px 16px 8px", display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <div style={{
            fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 500,
            letterSpacing: "-0.01em",
          }}>
            {tabs.find(t => t.id === panel).label}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-faint)" }}>
            <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
              {tabs.find(t => t.id === panel).count}
            </span>
            <button style={proposedTinyBtn}><Icon name="plus" size={12} /></button>
            <button style={proposedTinyBtn}><Icon name="search" size={12} /></button>
          </div>
        </div>

        {/* secondary toolbar — visible on Notes only */}
        {panel === "notes" && (
          <div style={{ display: "flex", gap: 2, padding: "0 12px 8px" }}>
            <button style={proposedTinyBtn}><Icon name="expandAll" size={12} /></button>
            <button style={proposedTinyBtn}><Icon name="collapseAll" size={12} /></button>
            <button style={{ ...proposedTinyBtn, color: "var(--accent)" }}>
              <Icon name="reveal" size={12} />
            </button>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 10.5, color: "var(--text-faint)", fontFamily: "var(--font-mono)", alignSelf: "center" }}>
              sort · modified
            </span>
          </div>
        )}

        {panel === "notes" && <ProposedNotesPanel />}
        {panel === "tags" && <ProposedTagsPanel />}
        {panel === "sites" && <ProposedSitesPanel />}
        {panel === "tables" && <ProposedTablesPanel />}
      </div>
    </Surface>
  );
};

const ProposedNotesPanel = () => {
  const Row = ({ depth = 0, kind, name, modified, dirty, active, dim }) => (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "5px 12px 5px",
      paddingLeft: 12 + depth * 16,
      background: active ? "color-mix(in oklch, var(--accent) 14%, transparent)" : "transparent",
      borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent",
      color: dim ? "var(--text-faint)" : (active ? "var(--text)" : "var(--text)"),
      cursor: "pointer", fontSize: 13,
      position: "relative",
    }}>
      {kind === "folder-open" && <Icon name="chevronDown" size={11} color="var(--text-faint)" />}
      {kind === "folder-closed" && <Icon name="chevronRight" size={11} color="var(--text-faint)" />}
      {kind?.startsWith("folder") && <Icon name="folder" size={14} color="var(--text-muted)" />}
      {kind === "note" && (
        <>
          <span style={{ width: 11 }} />
          <Icon name="notes" size={13} color={active ? "var(--accent)" : "var(--text-faint)"} />
        </>
      )}
      <span style={{
        flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        fontFamily: "var(--font-sans)",
      }}>{name}</span>
      {dirty && <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--accent)" }} />}
      {modified && !dirty && (
        <span style={{ fontSize: 10.5, color: "var(--text-faint)", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
          {modified}
        </span>
      )}
    </div>
  );
  return (
    <div style={{ flex: 1, overflow: "hidden", paddingBottom: 8 }}>
      <Row kind="folder-open" name="my-thoughts" />
      <Row depth={1} kind="folder-open" name="essays" />
      <Row depth={2} kind="note" name="On the trust principle" dirty active />
      <Row depth={2} kind="note" name="Epistemic defects" modified="2h" />
      <Row depth={2} kind="note" name="How autocomplete should feel" modified="5d" />
      <Row depth={1} kind="folder-closed" name="ontology" />
      <Row depth={1} kind="folder-closed" name="journal" />
      <Row depth={1} kind="folder-open" name="raft" />
      <Row depth={2} kind="note" name="Leader election proofs" modified="1mo" dim />
      <Row depth={2} kind="note" name="Why log replication is the easy part" modified="1mo" dim />
      <Row depth={1} kind="note" name="README" modified="3w" />
      <Row depth={1} kind="note" name="index" modified="2d" />
    </div>
  );
};

const ProposedTagsPanel = () => {
  // Tags as a constellation, not a list — each is a chip with weight.
  const tags = [
    { t: "claim",        n: 89, big: true },
    { t: "epistemology", n: 47, big: true },
    { t: "warrant",      n: 31, big: true },
    { t: "draft",        n: 23 },
    { t: "bias",         n: 18 },
    { t: "open-question", n: 14, accent: true },
    { t: "fallacy",      n: 12 },
    { t: "entrypoint",   n: 8, accent: true },
    { t: "stale",        n: 5 },
    { t: "hypothesis",   n: 4 },
    { t: "decided",      n: 3 },
  ];
  return (
    <div style={{ flex: 1, overflow: "hidden", padding: "4px 14px 14px" }}>
      <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 8, fontFamily: "var(--font-mono)" }}>
        used across 184 notes
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {tags.map((tag) => (
          <span key={tag.t} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: tag.big ? "4px 10px" : "3px 8px",
            background: tag.accent ? "color-mix(in oklch, var(--accent) 14%, transparent)" : "var(--bg)",
            color: tag.accent ? "var(--accent)" : "var(--text)",
            border: tag.accent ? "1px solid color-mix(in oklch, var(--accent) 30%, transparent)" : "1px solid var(--border)",
            borderRadius: 999,
            fontSize: tag.big ? 12.5 : 11.5,
            fontFamily: "var(--font-sans)",
          }}>
            <span>#{tag.t}</span>
            <span style={{
              fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums",
              fontSize: 10.5, color: tag.accent ? "var(--accent-dim)" : "var(--text-faint)",
            }}>{tag.n}</span>
          </span>
        ))}
      </div>
    </div>
  );
};

const ProposedSitesPanel = () => {
  const sources = [
    { au: "Plato",          ti: "Republic",            yr: "375 BCE", n: 23 },
    { au: "Quine",          ti: "Two Dogmas",          yr: "1951",    n: 9 },
    { au: "Toulmin",        ti: "The Uses of Argument", yr: "1958",   n: 17 },
    { au: "Popper",         ti: "Conjectures & Refutations", yr: "1963", n: 12 },
    { au: "Kahneman",       ti: "Thinking, Fast and Slow", yr: "2011", n: 8 },
    { au: "Sextus Empiricus", ti: "Outlines of Pyrrhonism", yr: "200", n: 4 },
  ];
  return (
    <div style={{ flex: 1, overflow: "hidden", padding: "4px 0 14px" }}>
      {sources.map((s, i) => (
        <div key={i} style={{
          padding: "10px 16px",
          borderTop: i === 0 ? "none" : "1px solid var(--border)",
          display: "flex", gap: 12, alignItems: "baseline",
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: "var(--font-display)", fontStyle: "italic",
              fontSize: 13.5, color: "var(--text)",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>{s.ti}</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>
              {s.au} · <span style={{ fontFamily: "var(--font-mono)" }}>{s.yr}</span>
            </div>
          </div>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            color: "var(--text-faint)", fontSize: 10.5, fontFamily: "var(--font-mono)",
          }}>
            <Icon name="citations" size={11} />
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{s.n}</span>
          </div>
        </div>
      ))}
    </div>
  );
};

const ProposedTablesPanel = () => {
  const tables = [
    { n: "claims_by_status",    rows: 184, cols: 5 },
    { n: "warrants_by_strength", rows: 31, cols: 4 },
    { n: "sources_cited",       rows: 27, cols: 6 },
    { n: "open_questions",      rows: 14, cols: 3 },
  ];
  return (
    <div style={{ flex: 1, overflow: "hidden", padding: "0 0 14px" }}>
      {tables.map((t, i) => (
        <div key={t.n} style={{
          padding: "10px 16px",
          borderTop: i === 0 ? "none" : "1px solid var(--border)",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <Icon name="tables" size={15} color="var(--text-muted)" />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text)" }}>
              {t.n}
            </div>
            <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 1, fontFamily: "var(--font-mono)" }}>
              {t.rows} × {t.cols}
            </div>
          </div>
          <button style={proposedTinyBtn}><Icon name="query" size={13} /></button>
        </div>
      ))}
    </div>
  );
};

const proposedTinyBtn = {
  border: "none", background: "transparent",
  color: "var(--text-muted)", padding: 4, borderRadius: 5,
  cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
};

window.MinervaLeftSidebar = {
  CurrentLeftSidebar, ProposedLeftSidebar,
};
