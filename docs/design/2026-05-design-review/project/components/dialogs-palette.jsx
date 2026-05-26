// Command palette (Goto Note) + Find in Notes dialogs.

const { Surface, catVars } = window.MinervaBits;
const { ModalShell, DialogCard } = window.MinervaDialogsCommon;
const Icon = window.MinervaIcon;

// ── Goto Note — CURRENT ────────────────────────────────────────────────
const CurrentGotoNote = ({ mode }) => (
  <ModalShell vars={catVars(mode)} scrim={.5}>
    <div style={{
      background: "var(--bg-sidebar)",
      border: "1px solid var(--border)",
      borderRadius: 8,
      width: 480,
      boxShadow: "0 8px 24px rgba(0,0,0,.4)",
      fontFamily: "-apple-system, system-ui, sans-serif",
      fontSize: 13,
      overflow: "hidden",
    }}>
      <div style={{ padding: 12 }}>
        <input style={{
          width: "100%", padding: "6px 10px",
          background: "var(--bg)", color: "var(--text)",
          border: "1px solid var(--border)", borderRadius: 4,
          fontSize: 13, outline: "none",
        }} defaultValue="trust" placeholder="Go to note..." />
      </div>
      <div style={{ borderTop: "1px solid var(--border)", padding: "4px 0", maxHeight: 240, overflow: "hidden" }}>
        {[
          { name: "on-the-trust-principle", path: "essays", sel: true },
          { name: "trust-tiers", path: "essays" },
          { name: "approval-trust", path: "ontology" },
          { name: "untrusted-llm-writes", path: "queries" },
        ].map((r, i) => (
          <div key={i} style={{
            padding: "4px 12px",
            background: r.sel ? "var(--bg-button)" : "transparent",
            color: "var(--text)", fontSize: 13,
          }}>
            <span>{r.name}</span>
            <span style={{ color: "var(--text-muted)", marginLeft: 6, fontSize: 11 }}>
              {r.path}
            </span>
          </div>
        ))}
      </div>
    </div>
  </ModalShell>
);

// ── Goto Note — PROPOSED ───────────────────────────────────────────────
const ProposedGotoNote = ({ vars, mode }) => {
  const results = [
    { name: "On the trust principle", path: "essays", kind: "note", match: [3, 8], modified: "now",
      preview: "The LLM proposes. The human confirms. This is the most important…",
      selected: true },
    { name: "Trust tiers", path: "essays", kind: "note", match: [0, 5], modified: "2h",
      preview: "requires_approval · notify_only · autonomous." },
    { name: "Approval & trust", path: "ontology", kind: "note", match: [9, 14], modified: "1w",
      preview: "How approval gates implement the trust principle." },
    { name: "Untrusted LLM writes", path: "queries", kind: "query", match: [0, 9], modified: "—",
      preview: "SPARQL · finds Component nodes without approved proposals." },
    { name: "Toulmin — Uses of Argument", path: "sites", kind: "source", match: [], modified: "—",
      preview: "Cited from 17 notes · last viewed 4d ago." },
  ];
  return (
    <ModalShell vars={vars} scrim={.45}>
      <DialogCard width={640} style={{ overflow: "hidden" }}>
        {/* Input row */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "14px 18px",
          borderBottom: "1px solid var(--border)",
        }}>
          <Icon name="search" size={16} color="var(--text-muted)" />
          <input style={{
            flex: 1, background: "transparent", border: "none", outline: "none",
            color: "var(--text)", fontSize: 16,
            fontFamily: "var(--font-sans)",
          }} defaultValue="trust" placeholder="Go to a note, source, query…" />
          <kbd style={{
            fontFamily: "var(--font-mono)", fontSize: 10,
            padding: "2px 6px",
            background: "var(--bg-inset)", border: "1px solid var(--border)",
            borderRadius: 4, color: "var(--text-faint)",
          }}>⌘ P</kbd>
        </div>

        {/* Scope filter chips */}
        <div style={{
          display: "flex", gap: 5,
          padding: "8px 16px 6px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg)",
          fontSize: 11,
        }}>
          {[
            { l: "All", n: 184, active: true },
            { l: "Notes", n: 162 },
            { l: "Sources", n: 17 },
            { l: "Queries", n: 5 },
          ].map((c) => (
            <button key={c.l} style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "3px 9px", borderRadius: 999, border: "none",
              background: c.active ? "color-mix(in oklch, var(--accent) 16%, transparent)" : "transparent",
              color: c.active ? "var(--accent)" : "var(--text-muted)",
              fontFamily: "var(--font-sans)", fontSize: 11.5,
              cursor: "pointer",
            }}>
              <span>{c.l}</span>
              <span style={{
                fontFamily: "var(--font-mono)", fontSize: 10,
                color: c.active ? "var(--accent-dim)" : "var(--text-faint)",
              }}>{c.n}</span>
            </button>
          ))}
        </div>

        {/* Results */}
        <div style={{ padding: "6px 0", maxHeight: 340, overflow: "hidden" }}>
          {results.map((r, i) => (
            <div key={i} style={{
              display: "flex", gap: 12, padding: "10px 18px",
              background: r.selected ? "color-mix(in oklch, var(--accent) 12%, transparent)" : "transparent",
              borderLeft: r.selected ? "2px solid var(--accent)" : "2px solid transparent",
              alignItems: "flex-start",
            }}>
              <Icon name={r.kind === "query" ? "query" : r.kind === "source" ? "source" : "notes"}
                    size={15} color={r.selected ? "var(--accent)" : "var(--text-muted)"} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{
                    fontFamily: "var(--font-sans)", fontSize: 13.5,
                    fontWeight: r.selected ? 500 : 450,
                    color: "var(--text)",
                  }}>
                    {r.match.length === 2
                      ? <>
                          {r.name.slice(0, r.match[0])}
                          <mark style={{
                            background: "color-mix(in oklch, var(--accent) 28%, transparent)",
                            color: "var(--accent)", borderRadius: 2, padding: "0 1px",
                          }}>{r.name.slice(r.match[0], r.match[1])}</mark>
                          {r.name.slice(r.match[1])}
                        </>
                      : r.name}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>
                    {r.path}/
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>
                    {r.modified}
                  </span>
                </div>
                <div style={{
                  fontSize: 11.5, color: "var(--text-muted)", marginTop: 3,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>{r.preview}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: "8px 18px",
          borderTop: "1px solid var(--border)",
          background: "var(--bg)",
          display: "flex", alignItems: "center", gap: 14,
          fontSize: 10.5, color: "var(--text-faint)", fontFamily: "var(--font-mono)",
        }}>
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>⌥ ↵ open in split</span>
          <span style={{ marginLeft: "auto" }}>esc close</span>
        </div>
      </DialogCard>
    </ModalShell>
  );
};

// ── Find in Notes — CURRENT ────────────────────────────────────────────
const CurrentFind = ({ mode }) => (
  <ModalShell vars={catVars(mode)} scrim={.5}>
    <div style={{
      background: "var(--bg-sidebar)",
      border: "1px solid var(--border)",
      borderRadius: 8, width: 640,
      boxShadow: "0 8px 24px rgba(0,0,0,.4)",
      fontFamily: "-apple-system, system-ui, sans-serif",
      fontSize: 13,
    }}>
      <div style={{ display: "flex", alignItems: "center", padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
        <button style={{
          padding: "4px 10px", background: "var(--bg-button-hover)",
          color: "var(--text)", border: "none", borderRadius: 4, marginRight: 4, fontSize: 12,
        }}>Find</button>
        <button style={{
          padding: "4px 10px", background: "transparent",
          color: "var(--text-muted)", border: "none", borderRadius: 4, fontSize: 12,
        }}>Find &amp; Replace</button>
        <span style={{ marginLeft: "auto", color: "var(--text-muted)" }}>×</span>
      </div>
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <input style={{
          width: "100%", padding: "5px 10px", background: "var(--bg)",
          color: "var(--text)", border: "1px solid var(--border)", borderRadius: 4,
        }} defaultValue="proposal" placeholder="Find in notes…" />
        <div style={{ display: "flex", gap: 12, fontSize: 12, color: "var(--text-muted)" }}>
          <label><input type="checkbox" /> Aa</label>
          <label><input type="checkbox" /> .*</label>
          <span style={{ marginLeft: "auto" }}>23 matches in 7 files</span>
        </div>
      </div>
      <div style={{ borderTop: "1px solid var(--border)", padding: "6px 12px", maxHeight: 200, overflow: "hidden" }}>
        {[
          { file: "essays/on-the-trust-principle.md", matches: 4 },
          { file: "essays/approval-tiers.md", matches: 7 },
          { file: "ontology/write-guard.md", matches: 3 },
        ].map((f, i) => (
          <div key={i} style={{ padding: "3px 0" }}>
            <div style={{ color: "var(--text)" }}>▾ {f.file} ({f.matches})</div>
            <div style={{ paddingLeft: 16, color: "var(--text-muted)", fontSize: 11.5 }}>
              The LLM never writes directly to the graph. Instead, each proposal…
            </div>
          </div>
        ))}
      </div>
    </div>
  </ModalShell>
);

// ── Find in Notes — PROPOSED ───────────────────────────────────────────
const ProposedFind = ({ vars, mode }) => {
  const files = [
    {
      path: "essays/on-the-trust-principle.md", matches: [
        { line: 12, before: "Each LLM-originated mutation produces a ", match: "proposal", after: " node with provenance.", checked: true },
        { line: 41, before: "Auto-expire after a configurable window if the ", match: "proposal", after: " isn't reviewed.", checked: true },
        { line: 88, before: "The diff view stacks every pending ", match: "Proposal", after: " by recency.", checked: true },
      ],
      expanded: true,
    },
    {
      path: "essays/approval-tiers.md", matches: [
        { line: 7, before: "Queues a ", match: "proposal", after: " node and waits for human review.", checked: true },
        { line: 22, before: "The activity feed surfaces every ", match: "Proposal", after: " that bypassed the gate.", checked: false },
      ],
      expanded: true,
    },
    { path: "ontology/write-guard.md", matches: [], collapsed: true, count: 3 },
    { path: "journal/2026-w20.md", matches: [], collapsed: true, count: 2 },
  ];
  return (
    <ModalShell vars={vars} scrim={.45}>
      <DialogCard width={720} style={{ overflow: "hidden" }}>
        {/* Header — segmented mode */}
        <div style={{
          display: "flex", alignItems: "center",
          padding: "12px 18px",
          borderBottom: "1px solid var(--border)",
        }}>
          <div style={{
            display: "flex", padding: 3, gap: 2,
            background: "var(--bg-inset)", borderRadius: 7,
            border: "1px solid var(--border)",
          }}>
            <button style={{
              padding: "4px 12px", borderRadius: 5, border: "none", fontFamily: "inherit",
              background: "var(--bg-elev)", color: "var(--text)",
              boxShadow: "0 1px 2px rgba(0,0,0,.1)",
              fontSize: 12, fontWeight: 500, cursor: "pointer",
            }}>Find</button>
            <button style={{
              padding: "4px 12px", borderRadius: 5, border: "none", fontFamily: "inherit",
              background: "transparent", color: "var(--text-muted)",
              fontSize: 12, fontWeight: 450, cursor: "pointer",
            }}>Find &amp; Replace</button>
          </div>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11.5, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            <strong style={{ color: "var(--accent)", fontWeight: 600 }}>23</strong> matches ·{" "}
            <strong style={{ color: "var(--text)", fontWeight: 500 }}>7</strong> files
          </span>
          <button style={{
            marginLeft: 12, border: "none", background: "transparent",
            color: "var(--text-muted)", padding: 4, borderRadius: 5, cursor: "pointer",
          }}><Icon name="close" size={14} /></button>
        </div>

        {/* Inputs */}
        <div style={{ padding: "14px 18px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 0,
            background: "var(--bg-inset)",
            border: "1px solid var(--accent)",
            boxShadow: "0 0 0 3px color-mix(in oklch, var(--accent) 18%, transparent)",
            borderRadius: 7,
          }}>
            <span style={{ padding: "0 12px", color: "var(--text-muted)" }}><Icon name="search" size={14} /></span>
            <input style={{
              flex: 1, padding: "8px 0", border: "none", background: "transparent",
              color: "var(--text)", fontSize: 13.5, outline: "none",
              fontFamily: "var(--font-mono)",
            }} defaultValue="proposal" />
            <div style={{ display: "flex", gap: 2, padding: 4 }}>
              <FlagBtn label="Aa" title="Match case" />
              <FlagBtn label=".*" title="Regex" active />
              <FlagBtn label="W" title="Whole word" />
            </div>
          </div>
        </div>

        {/* Results — file accordion with checkboxes */}
        <div style={{ padding: "0 8px 6px", maxHeight: 320, overflow: "hidden" }}>
          {files.map((f, fi) => (
            <div key={fi} style={{ borderTop: fi === 0 ? "none" : "1px solid var(--border)" }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 10px",
                cursor: "pointer",
              }}>
                <input type="checkbox" style={{ accentColor: "var(--accent)" }}
                       defaultChecked={!f.collapsed && f.matches.every(m => m.checked)} />
                <Icon name={f.expanded ? "chevronDown" : "chevronRight"} size={11} color="var(--text-faint)" />
                <Icon name="notes" size={13} color="var(--text-muted)" />
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 12.5,
                  color: "var(--text)", flex: 1,
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                }}>{f.path}</span>
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 11,
                  color: "var(--text-faint)",
                }}>{f.matches.length || f.count} matches</span>
              </div>
              {f.expanded && f.matches.map((m, mi) => (
                <div key={mi} style={{
                  display: "flex", alignItems: "baseline", gap: 8,
                  padding: "5px 10px 5px 44px",
                  background: mi === 0 && fi === 0 ? "color-mix(in oklch, var(--accent) 7%, transparent)" : "transparent",
                  borderLeft: mi === 0 && fi === 0 ? "2px solid var(--accent)" : "2px solid transparent",
                  marginLeft: -2,
                  cursor: "pointer",
                }}>
                  <input type="checkbox" style={{ accentColor: "var(--accent)" }} defaultChecked={m.checked} />
                  <span style={{
                    fontFamily: "var(--font-mono)", fontSize: 10.5,
                    color: "var(--text-faint)", width: 30, textAlign: "right",
                  }}>{m.line}</span>
                  <span style={{
                    fontFamily: "var(--font-mono)", fontSize: 12,
                    color: "var(--text)", flex: 1,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>
                    <span style={{ color: "var(--text-muted)" }}>{m.before}</span>
                    <mark style={{
                      background: "color-mix(in oklch, var(--accent) 26%, transparent)",
                      color: "var(--accent)", borderRadius: 2, padding: "0 2px",
                      fontWeight: 500,
                    }}>{m.match}</mark>
                    <span style={{ color: "var(--text-muted)" }}>{m.after}</span>
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: "10px 18px",
          borderTop: "1px solid var(--border)",
          background: "var(--bg)",
          display: "flex", alignItems: "center", gap: 14,
          fontSize: 11, color: "var(--text-faint)", fontFamily: "var(--font-mono)",
        }}>
          <span>↑↓ next · ↵ open · ⌥ ↵ split</span>
          <span style={{ marginLeft: "auto" }}>esc close</span>
        </div>
      </DialogCard>
    </ModalShell>
  );
};

const FlagBtn = ({ label, active, title }) => (
  <button title={title} style={{
    padding: "3px 7px", borderRadius: 5, border: "none",
    background: active ? "color-mix(in oklch, var(--accent) 18%, transparent)" : "transparent",
    color: active ? "var(--accent)" : "var(--text-muted)",
    fontFamily: "var(--font-mono)", fontSize: 11, cursor: "pointer", fontWeight: 600,
  }}>{label}</button>
);

window.MinervaDialogsPalette = {
  CurrentGotoNote, ProposedGotoNote,
  CurrentFind, ProposedFind,
};
