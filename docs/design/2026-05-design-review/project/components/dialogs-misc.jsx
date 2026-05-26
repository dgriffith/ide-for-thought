// Save Query · Auto-link · Export · Open Target — current vs proposed.

const { Surface, catVars } = window.MinervaBits;
const { ModalShell, DialogCard } = window.MinervaDialogsCommon;
const Icon = window.MinervaIcon;

// ── Save Query — CURRENT ───────────────────────────────────────────────
const CurrentSaveQuery = ({ mode }) => (
  <ModalShell vars={catVars(mode)} scrim={.5}>
    <div style={{
      background: "var(--bg-sidebar)", border: "1px solid var(--border)",
      borderRadius: 8, padding: 16, width: 380,
      boxShadow: "0 8px 24px rgba(0,0,0,.4)",
      fontFamily: "-apple-system, system-ui, sans-serif",
      fontSize: 13, display: "flex", flexDirection: "column", gap: 12,
      color: "var(--text)",
    }}>
      <label style={{ margin: 0 }}>Save query as</label>
      <input type="text" style={{
        padding: "6px 10px", border: "1px solid var(--accent)",
        borderRadius: 4, background: "var(--bg)", color: "var(--text)", fontSize: 13,
      }} defaultValue="Unreviewed LLM writes" />
      <fieldset style={{ border: "1px solid var(--border)", borderRadius: 4, padding: 8 }}>
        <legend style={{ color: "var(--text-muted)", fontSize: 11, padding: "0 4px" }}>Scope</legend>
        <label style={{ display: "flex", gap: 6, padding: "2px 0" }}>
          <input type="radio" name="scope" defaultChecked /> Project <span style={{ color: "var(--text-muted)" }}>— this project only</span>
        </label>
        <label style={{ display: "flex", gap: 6, padding: "2px 0" }}>
          <input type="radio" name="scope" /> Global <span style={{ color: "var(--text-muted)" }}>— available everywhere</span>
        </label>
      </fieldset>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button style={{ padding: "5px 14px", borderRadius: 4, fontSize: 12, background: "var(--bg-button)", color: "var(--text)", border: "1px solid var(--border)" }}>Cancel</button>
        <button style={{ padding: "5px 14px", borderRadius: 4, fontSize: 12, background: "var(--accent)", color: "var(--bg)", border: "1px solid var(--accent)" }}>Save</button>
      </div>
    </div>
  </ModalShell>
);

// ── Save Query — PROPOSED ──────────────────────────────────────────────
const ProposedSaveQuery = ({ vars, mode }) => (
  <ModalShell vars={vars}>
    <DialogCard width={500}>
      <div style={{ padding: "20px 24px 0" }}>
        <div style={{
          fontFamily: "var(--font-mono)", fontSize: 10.5,
          color: "var(--text-faint)", letterSpacing: ".08em",
          textTransform: "uppercase", marginBottom: 6,
        }}>SPARQL · 13 lines</div>
        <div style={{
          fontFamily: "var(--font-display)", fontSize: 19,
          fontWeight: 500, letterSpacing: "-0.005em",
        }}>Save this query</div>
      </div>

      <div style={{ padding: "14px 24px 0", display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={fieldLabel}>Name</label>
          <input style={fieldInput} defaultValue="Unreviewed LLM writes" />
        </div>

        <div>
          <label style={fieldLabel}>Where it lives</label>
          <div style={{
            display: "flex", gap: 8,
            background: "var(--bg-inset)", padding: 3, borderRadius: 7,
            border: "1px solid var(--border)",
          }}>
            <ScopeCard active label="In this thoughtbase" icon="notes"
              sub="Saved into the project · stays with my-thoughts/" />
            <ScopeCard label="Globally" icon="settings"
              sub="Available in every project on this machine" />
          </div>
        </div>
      </div>

      <div style={{
        padding: "16px 18px 12px", borderTop: "1px solid var(--border)",
        marginTop: 18,
        background: "var(--bg)", borderRadius: "0 0 12px 12px",
        display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center",
      }}>
        <span style={{ marginRight: "auto", fontSize: 10.5, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>
          esc cancel · ↵ save
        </span>
        <button style={btnGhost}>Cancel</button>
        <button style={btnPrimary}>Save query</button>
      </div>
    </DialogCard>
  </ModalShell>
);

const ScopeCard = ({ active, label, sub, icon }) => (
  <div style={{
    flex: 1, padding: "9px 12px", borderRadius: 5,
    background: active ? "var(--bg-elev)" : "transparent",
    boxShadow: active ? "0 1px 2px rgba(0,0,0,.1)" : "none",
    cursor: "pointer",
  }}>
    <div style={{
      display: "flex", alignItems: "center", gap: 6, color: active ? "var(--accent)" : "var(--text-muted)",
      fontSize: 12, fontWeight: 500,
    }}>
      <Icon name={icon} size={12} />
      {label}
    </div>
    <div style={{ marginTop: 4, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.35 }}>
      {sub}
    </div>
  </div>
);

// ── Auto-link — CURRENT ────────────────────────────────────────────────
const CurrentAutoLink = ({ mode }) => (
  <ModalShell vars={catVars(mode)} scrim={.5}>
    <div style={{
      background: "var(--bg-sidebar)", border: "1px solid var(--border)",
      borderRadius: 8, width: 580, maxHeight: 480,
      boxShadow: "0 8px 24px rgba(0,0,0,.4)",
      fontFamily: "-apple-system, system-ui, sans-serif",
      fontSize: 13, display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between" }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--text)" }}>Auto-link suggestions</h2>
        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>5 of 5 selected</span>
      </div>
      <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--border)", display: "flex", gap: 10 }}>
        <button style={{ background: "none", border: "none", color: "var(--accent)", fontSize: 12 }}>Select all</button>
        <button style={{ background: "none", border: "none", color: "var(--accent)", fontSize: 12 }}>Select none</button>
      </div>
      <div style={{ padding: 12, overflow: "hidden" }}>
        {[
          { a: "approval engine", t: "approval-engine", r: "Strong name match in same folder." },
          { a: "raft", t: "raft", r: "Existing note title." },
          { a: "Toulmin's warrants", t: "toulmin-warrants", r: "Fuzzy title match (0.84)." },
        ].map((s, i) => (
          <label key={i} style={{ display: "flex", gap: 10, padding: "6px 0", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
            <input type="checkbox" defaultChecked />
            <div style={{ flex: 1, fontSize: 12 }}>
              <div><span>{s.a}</span> → <code style={{ color: "var(--accent)" }}>[[{s.t}]]</code></div>
              <div style={{ color: "var(--text-muted)", fontSize: 11 }}>{s.r}</div>
            </div>
          </label>
        ))}
      </div>
      <div style={{ padding: "8px 16px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button style={{ padding: "5px 14px", borderRadius: 4, fontSize: 12, background: "var(--bg-button)", color: "var(--text)", border: "1px solid var(--border)" }}>Cancel</button>
        <button style={{ padding: "5px 14px", borderRadius: 4, fontSize: 12, background: "var(--accent)", color: "var(--bg)", border: "1px solid var(--accent)" }}>Apply 5</button>
      </div>
    </div>
  </ModalShell>
);

// ── Auto-link — PROPOSED ───────────────────────────────────────────────
const ProposedAutoLink = ({ vars, mode }) => {
  const suggestions = [
    { anchor: "approval engine", target: "approval-engine", reason: "Exact title match in essays/", confidence: .96, kept: true, context: "All LLM-originated graph mutations must go through the **approval engine**. The LLM never writes…" },
    { anchor: "raft", target: "raft", reason: "Note title", confidence: .92, kept: true, context: "as a distributed log; **raft** is the canonical reference protocol." },
    { anchor: "Toulmin's warrants", target: "toulmin-warrants", reason: "Slug-fuzzy match (0.84) + alias", confidence: .84, kept: true, context: "What grounds the claim? In **Toulmin's warrants** this is the link from…" },
    { anchor: "epistemic defects", target: "epistemic-defects", reason: "Exact title match", confidence: 1.0, kept: true, context: "These are the **epistemic defects** the ontology indexes." },
    { anchor: "proposal", target: "proposal-node", reason: "Slug match · 4 candidates collapsed", confidence: .61, kept: false, context: "Each LLM operation produces a **proposal** with provenance." },
  ];
  const keptCount = suggestions.filter(s => s.kept).length;
  return (
    <ModalShell vars={vars} scrim={.45}>
      <DialogCard width={760} style={{ overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: 600 }}>
        {/* Header */}
        <div style={{ padding: "18px 24px 14px", borderBottom: "1px solid var(--border)" }}>
          <div style={{
            fontFamily: "var(--font-mono)", fontSize: 10.5,
            color: "var(--accent)", letterSpacing: ".08em",
            textTransform: "uppercase", marginBottom: 5,
          }}>Review · auto-link</div>
          <div style={{
            display: "flex", alignItems: "baseline", justifyContent: "space-between",
          }}>
            <div style={{
              fontFamily: "var(--font-display)", fontSize: 20, fontWeight: 500,
              letterSpacing: "-0.005em",
            }}>{suggestions.length} suggestions in this note</div>
            <span style={{ fontSize: 11.5, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
              <strong style={{ color: "var(--accent)", fontWeight: 600 }}>{keptCount}</strong> · selected
            </span>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 10 }}>
            <button style={{ ...btnGhost, padding: "3px 9px", fontSize: 11.5 }}>Select all</button>
            <button style={{ ...btnGhost, padding: "3px 9px", fontSize: 11.5 }}>Select high-confidence (≥ 0.8)</button>
            <button style={{ ...btnGhost, padding: "3px 9px", fontSize: 11.5 }}>None</button>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>
              sort · confidence
            </span>
          </div>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflow: "hidden", padding: "6px 0" }}>
          {suggestions.map((s, i) => (
            <div key={i} style={{
              padding: "10px 24px",
              borderBottom: i === suggestions.length - 1 ? "none" : "1px solid var(--border)",
              opacity: s.kept ? 1 : .55,
              background: s.kept && i === 0 ? "color-mix(in oklch, var(--accent) 6%, transparent)" : "transparent",
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <input type="checkbox" defaultChecked={s.kept} style={{ accentColor: "var(--accent)", marginTop: 2 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                    <span style={{
                      padding: "2px 8px", background: "var(--bg-inset)",
                      border: "1px solid var(--border)",
                      borderRadius: 4, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text)",
                    }}>{s.anchor}</span>
                    <span style={{ color: "var(--text-faint)", fontSize: 14 }}>→</span>
                    <span style={{
                      padding: "2px 8px",
                      background: "color-mix(in oklch, var(--accent) 14%, transparent)",
                      color: "var(--accent)",
                      borderRadius: 4, fontFamily: "var(--font-mono)", fontSize: 12,
                      display: "inline-flex", alignItems: "center", gap: 4,
                    }}>
                      <Icon name="link" size={10} />
                      [[{s.target}]]
                    </span>
                    <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                      <ConfidenceBar value={s.confidence} />
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 6 }}>{s.reason}</div>
                  <div style={{
                    fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-faint)",
                    marginTop: 6, padding: "4px 8px",
                    background: "var(--bg-inset)", borderRadius: 4, borderLeft: "2px solid var(--border-strong)",
                  }}>
                    {s.context}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: "12px 22px",
          borderTop: "1px solid var(--border)",
          background: "var(--bg)",
          display: "flex", gap: 8, alignItems: "center",
        }}>
          <span style={{ marginRight: "auto", fontSize: 10.5, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>
            ⏎ apply selected · ⌫ skip
          </span>
          <button style={btnGhost}>Cancel</button>
          <button style={btnPrimary}>Apply {keptCount} link{keptCount === 1 ? "" : "s"}</button>
        </div>
      </DialogCard>
    </ModalShell>
  );
};

const ConfidenceBar = ({ value }) => (
  <span style={{
    display: "inline-flex", alignItems: "center", gap: 6,
    fontVariantNumeric: "tabular-nums",
    color: value >= 0.85 ? "var(--sage)" : value >= 0.7 ? "var(--accent)" : "var(--text-faint)",
  }}>
    <span style={{
      width: 36, height: 4, borderRadius: 999,
      background: "var(--border)", overflow: "hidden", display: "inline-block",
    }}>
      <span style={{
        display: "block", height: "100%", width: `${value * 100}%`,
        background: "currentColor",
      }} />
    </span>
    {value.toFixed(2)}
  </span>
);

// ── Export — CURRENT ───────────────────────────────────────────────────
const CurrentExport = ({ mode }) => (
  <ModalShell vars={catVars(mode)} scrim={.5}>
    <div style={{
      background: "var(--bg-sidebar)", border: "1px solid var(--border)",
      borderRadius: 8, width: 580, maxHeight: 520,
      boxShadow: "0 8px 24px rgba(0,0,0,.4)",
      fontFamily: "-apple-system, system-ui, sans-serif",
      fontSize: 13, display: "flex", flexDirection: "column",
      overflow: "hidden",
    }}>
      <h2 style={{ padding: "12px 16px", margin: 0, fontSize: 14, fontWeight: 600, borderBottom: "1px solid var(--border)", color: "var(--text)" }}>
        Export as Static site
      </h2>
      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)" }}>
        <div style={{ color: "var(--text-muted)", fontSize: 11, marginBottom: 4 }}>Scope</div>
        <label style={{ display: "block", padding: "2px 0" }}><input type="radio" name="s" defaultChecked /> Current note</label>
        <label style={{ display: "block", padding: "2px 0" }}><input type="radio" name="s" /> All notes</label>
        <label style={{ display: "block", padding: "2px 0" }}><input type="radio" name="s" /> Tagged: <code>#published</code></label>
      </div>
      <div style={{ padding: 12, overflow: "hidden", flex: 1 }}>
        <h3 style={{ fontSize: 12, margin: "0 0 6px", color: "var(--text)" }}>Including 12 notes</h3>
        {["essays/on-the-trust-principle.md", "essays/approval-tiers.md", "ontology/write-guard.md"].map((p) => (
          <div key={p} style={{ display: "flex", gap: 8, fontSize: 12, padding: "2px 0", color: "var(--text-muted)" }}>
            <input type="checkbox" defaultChecked /> {p}
          </div>
        ))}
        <h3 style={{ fontSize: 12, margin: "8px 0 6px", color: "var(--text)" }}>Excluded 2</h3>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>journal/2026-w20.md · #draft</div>
      </div>
      <div style={{ padding: "8px 16px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button style={{ padding: "5px 14px", borderRadius: 4, fontSize: 12, background: "var(--bg-button)", color: "var(--text)", border: "1px solid var(--border)" }}>Cancel</button>
        <button style={{ padding: "5px 14px", borderRadius: 4, fontSize: 12, background: "var(--accent)", color: "var(--bg)", border: "1px solid var(--accent)" }}>Export…</button>
      </div>
    </div>
  </ModalShell>
);

// ── Export — PROPOSED ──────────────────────────────────────────────────
const ProposedExport = ({ vars, mode }) => (
  <ModalShell vars={vars} scrim={.45}>
    <DialogCard width={780} style={{ overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: 600 }}>
      <div style={{ padding: "18px 24px 12px", borderBottom: "1px solid var(--border)" }}>
        <div style={{
          fontFamily: "var(--font-mono)", fontSize: 10.5,
          color: "var(--accent)", letterSpacing: ".08em",
          textTransform: "uppercase", marginBottom: 5,
        }}>publish · static site</div>
        <div style={{
          fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 500,
          letterSpacing: "-0.01em",
        }}>Export your thoughtbase</div>
      </div>

      <div style={{
        padding: "16px 24px 8px", borderBottom: "1px solid var(--border)",
        display: "flex", gap: 14, alignItems: "center",
      }}>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Scope</div>
        <div style={{
          display: "flex", background: "var(--bg-inset)",
          padding: 3, borderRadius: 7, border: "1px solid var(--border)",
        }}>
          <ScopeBtn label="Current note" />
          <ScopeBtn label="Tagged" active counter="12" />
          <ScopeBtn label="Folder" />
          <ScopeBtn label="All notes" counter="184" />
        </div>
        <div style={{
          marginLeft: 8, display: "inline-flex", alignItems: "center", gap: 6,
          padding: "4px 10px",
          background: "color-mix(in oklch, var(--accent) 14%, transparent)",
          color: "var(--accent)",
          borderRadius: 999, fontFamily: "var(--font-mono)", fontSize: 11.5,
        }}>
          #published
          <Icon name="close" size={10} />
        </div>
      </div>

      {/* audit columns */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", flex: 1, overflow: "hidden" }}>
        <AuditCol title="Including" count={12} accent="sage" rows={[
          { t: "On the trust principle", p: "essays/on-the-trust-principle.md", checked: true },
          { t: "Approval tiers", p: "essays/approval-tiers.md", checked: true },
          { t: "Write guard", p: "ontology/write-guard.md", checked: true },
          { t: "Epistemic defects", p: "ontology/epistemic-defects.md", checked: true },
          { t: "Why proposals?", p: "essays/why-proposals.md", checked: true },
        ]} more={7} />
        <AuditCol title="Excluded" count={2} muted rows={[
          { t: "2026-w20", p: "journal/2026-w20.md", reason: "#draft", clickable: true },
          { t: "Index", p: "index.md", reason: "no published tag" },
        ]} />
        <AuditCol title="Citations" count={17} accent="iris" missing={1} rows={[
          { t: "Plato — Republic", p: "Plato_Republic_375BCE", reason: "23 refs" },
          { t: "Toulmin", p: "Toulmin_1958", reason: "17 refs" },
          { t: "[missing: Quine_1951]", p: "—", reason: "9 refs", warn: true },
        ]} />
      </div>

      <div style={{
        padding: "12px 22px",
        borderTop: "1px solid var(--border)",
        background: "var(--bg)",
        display: "flex", gap: 8, alignItems: "center",
      }}>
        <span style={{ marginRight: "auto", fontSize: 11, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>
          output → <span style={{ color: "var(--text-muted)" }}>~/Sites/my-thoughts/</span>
        </span>
        <button style={btnGhost}>Cancel</button>
        <button style={{
          ...btnPrimary, display: "inline-flex", alignItems: "center", gap: 6,
        }}>
          <Icon name="send" size={11} /> Export 12 notes
        </button>
      </div>
    </DialogCard>
  </ModalShell>
);

const ScopeBtn = ({ label, active, counter }) => (
  <button style={{
    display: "inline-flex", alignItems: "center", gap: 5,
    padding: "4px 10px", borderRadius: 5, border: "none", fontFamily: "inherit",
    background: active ? "var(--bg-elev)" : "transparent",
    boxShadow: active ? "0 1px 2px rgba(0,0,0,.1)" : "none",
    color: active ? "var(--text)" : "var(--text-muted)",
    fontSize: 11.5, fontWeight: active ? 500 : 450, cursor: "pointer",
  }}>
    {label}
    {counter && <span style={{
      fontFamily: "var(--font-mono)", fontSize: 10,
      color: active ? "var(--accent)" : "var(--text-faint)",
    }}>{counter}</span>}
  </button>
);

const AuditCol = ({ title, count, accent, muted, rows, more, missing }) => (
  <div style={{
    padding: "12px 18px",
    borderRight: "1px solid var(--border)",
    overflow: "hidden",
  }}>
    <div style={{
      display: "flex", alignItems: "baseline", gap: 8,
      fontFamily: "var(--font-mono)", fontSize: 10.5,
      color: "var(--text-faint)", letterSpacing: ".08em",
      textTransform: "uppercase", marginBottom: 8,
    }}>
      <span>{title}</span>
      <span style={{
        color: accent === "sage" ? "var(--sage)" : accent === "iris" ? "var(--iris)" : "var(--text)",
        fontWeight: 600, fontSize: 11,
      }}>{count}</span>
      {missing > 0 && (
        <span style={{ color: "var(--rust)", fontSize: 10 }}>
          · {missing} missing
        </span>
      )}
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((r, i) => (
        <div key={i} style={{
          display: "flex", flexDirection: "column", gap: 1,
          opacity: muted ? .85 : 1,
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            fontSize: 12, color: r.warn ? "var(--rust)" : "var(--text)",
          }}>
            {!muted && <input type="checkbox" defaultChecked={r.checked} style={{ accentColor: "var(--accent)" }} />}
            <span style={{
              flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>{r.t}</span>
          </div>
          <div style={{
            paddingLeft: muted ? 0 : 18,
            fontSize: 10.5, color: "var(--text-faint)", fontFamily: "var(--font-mono)",
            display: "flex", justifyContent: "space-between", gap: 6,
          }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.p}</span>
            {r.reason && <span style={{ flexShrink: 0 }}>{r.reason}</span>}
          </div>
        </div>
      ))}
      {more && (
        <div style={{ fontSize: 10.5, color: "var(--text-faint)", fontStyle: "italic" }}>
          …and {more} more
        </div>
      )}
    </div>
  </div>
);

// ── Open Target — PROPOSED only ────────────────────────────────────────
// (current is a basic 3-button dialog; proposed gives each option real estate)
const ProposedOpenTarget = ({ vars, mode }) => (
  <ModalShell vars={vars}>
    <DialogCard width={580}>
      <div style={{ padding: "20px 24px 0" }}>
        <div style={{
          fontFamily: "var(--font-mono)", fontSize: 10.5,
          color: "var(--text-faint)", letterSpacing: ".08em",
          textTransform: "uppercase", marginBottom: 5,
        }}>You're opening a new thoughtbase</div>
        <div style={{
          fontFamily: "var(--font-display)", fontSize: 19,
          fontWeight: 500, letterSpacing: "-0.005em",
        }}>
          Where would you like <code style={{ fontFamily: "var(--font-mono)", fontSize: 16, color: "var(--accent)" }}>research-notes</code> to open?
        </div>
      </div>
      <div style={{ padding: "16px 24px 8px", display: "flex", flexDirection: "column", gap: 8 }}>
        <ChoiceCard primary icon="reveal" title="Open in this window"
          sub="Closes my-thoughts and opens research-notes here. The current view is preserved in the dock." kbd="↵" />
        <ChoiceCard icon="plus" title="Open in a new window"
          sub="Keeps the current thoughtbase up and opens research-notes side by side." kbd="⌘ ↵" />
      </div>
      <div style={{
        padding: "12px 22px", borderTop: "1px solid var(--border)",
        background: "var(--bg)", borderRadius: "0 0 12px 12px",
        display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center",
      }}>
        <span style={{ marginRight: "auto", fontSize: 10.5, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>esc cancel</span>
        <button style={btnGhost}>Cancel</button>
      </div>
    </DialogCard>
  </ModalShell>
);

const ChoiceCard = ({ icon, title, sub, kbd, primary }) => (
  <div style={{
    display: "flex", gap: 12, alignItems: "flex-start",
    padding: "12px 14px",
    background: primary ? "color-mix(in oklch, var(--accent) 10%, transparent)" : "var(--bg-inset)",
    border: primary ? "1px solid color-mix(in oklch, var(--accent) 32%, transparent)" : "1px solid var(--border)",
    borderRadius: 8,
    cursor: "pointer",
  }}>
    <div style={{
      width: 32, height: 32, borderRadius: 7, flexShrink: 0,
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      background: primary ? "color-mix(in oklch, var(--accent) 22%, transparent)" : "var(--bg)",
      color: primary ? "var(--accent)" : "var(--text-muted)",
    }}>
      <Icon name={icon} size={16} />
    </div>
    <div style={{ flex: 1 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        fontFamily: "var(--font-sans)", fontSize: 13.5,
        fontWeight: 500, color: primary ? "var(--text)" : "var(--text)",
      }}>
        {title}
        <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <kbd style={{
            fontFamily: "var(--font-mono)", fontSize: 10,
            padding: "2px 6px", borderRadius: 4,
            background: "var(--bg)", border: "1px solid var(--border)",
            color: "var(--text-faint)",
          }}>{kbd}</kbd>
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.4 }}>{sub}</div>
    </div>
  </div>
);

// ── Shared styles ──────────────────────────────────────────────────────
const fieldLabel = {
  display: "block", marginBottom: 6,
  fontSize: 11, color: "var(--text-muted)",
  fontFamily: "var(--font-mono)",
  letterSpacing: ".04em", textTransform: "uppercase",
};
const fieldInput = {
  width: "100%", padding: "8px 10px",
  background: "var(--bg-inset)", color: "var(--text)",
  border: "1px solid var(--border)", borderRadius: 6,
  fontFamily: "var(--font-sans)", fontSize: 13, outline: "none",
};
const btnGhost = {
  padding: "7px 14px", borderRadius: 6, fontSize: 12.5,
  background: "transparent", color: "var(--text-muted)",
  border: "1px solid var(--border)", cursor: "pointer", fontFamily: "inherit",
};
const btnPrimary = {
  padding: "7px 14px", borderRadius: 6, fontSize: 12.5, fontWeight: 600,
  background: "var(--accent)", color: "var(--accent-ink)",
  border: "1px solid var(--accent)", cursor: "pointer", fontFamily: "inherit",
};

window.MinervaDialogsMisc = {
  CurrentSaveQuery, ProposedSaveQuery,
  CurrentAutoLink, ProposedAutoLink,
  CurrentExport, ProposedExport,
  ProposedOpenTarget,
};
