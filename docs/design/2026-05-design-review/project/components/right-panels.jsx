// Right-sidebar panel bodies — each shown inside a 320×h artboard with the
// proposed right-sidebar header chrome already drawn around it. These are
// the canonical layouts for every panel.

const { Surface } = window.MinervaBits;
const Icon = window.MinervaIcon;

// Wrap a panel body in the standard panel chrome — title row + body.
const PanelFrame = ({ vars, title, icon, count, sub, actions, children, footer }) => (
  <Surface vars={vars}>
    <div style={{
      width: "100%", height: "100%",
      background: "var(--bg-elev)",
      borderLeft: "1px solid var(--border)",
      display: "flex", flexDirection: "column",
      fontFamily: "var(--font-sans)", color: "var(--text)",
    }}>
      {/* Panel header */}
      <div style={{ padding: "14px 16px 10px", display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div>
          <div style={{
            fontFamily: "var(--font-mono)", fontSize: 10,
            color: "var(--accent)", letterSpacing: ".08em",
            textTransform: "uppercase", marginBottom: 2,
            display: "flex", alignItems: "center", gap: 5,
          }}>
            {icon && <Icon name={icon} size={11} />}
            {sub}
          </div>
          <div style={{
            fontFamily: "var(--font-display)", fontSize: 18,
            fontWeight: 500, letterSpacing: "-0.01em",
          }}>{title}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {count != null && (
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 11,
              color: "var(--text-faint)", fontVariantNumeric: "tabular-nums",
            }}>{count}</span>
          )}
          {actions}
        </div>
      </div>
      {/* Body */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        {children}
      </div>
      {footer}
    </div>
  </Surface>
);

const tinyBtn = {
  width: 22, height: 22, border: "none", background: "transparent",
  color: "var(--text-muted)", borderRadius: 5, cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center",
};

// ── PROPERTIES ─────────────────────────────────────────────────────────
const PropertiesPanel = ({ vars }) => {
  const Row = ({ k, type, children, canonical }) => (
    <div style={{
      display: "grid", gridTemplateColumns: "82px 1fr 18px",
      gap: 8, alignItems: "center",
      padding: "5px 16px",
      borderTop: "1px solid var(--border)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--text-muted)", fontSize: 11.5 }}>
        <Icon name={typeIcon(type)} size={10} color={canonical ? "var(--accent)" : "var(--text-faint)"} />
        <span style={{ fontFamily: "var(--font-mono)" }}>{k}</span>
      </div>
      <div style={{ minWidth: 0 }}>{children}</div>
      <button style={tinyBtn}><Icon name="close" size={10} /></button>
    </div>
  );
  return (
    <PanelFrame vars={vars} title="Properties" sub="Frontmatter"
                actions={<><button style={tinyBtn}><Icon name="plus" size={11} /></button></>}>
      <div style={{ padding: 0 }}>
        <Row k="title" type="text" canonical>
          <input style={propInput} defaultValue="On the trust principle" />
        </Row>
        <Row k="aliases" type="list" canonical>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {["trust", "human-confirms"].map((t) => (
              <span key={t} style={chipStyle}>
                {t}<Icon name="close" size={8} />
              </span>
            ))}
            <input style={{ ...propInput, width: 70, padding: "1px 6px" }} placeholder="+" />
          </div>
        </Row>
        <Row k="status" type="enum" canonical>
          <select style={propSelect} defaultValue="draft">
            <option>draft</option><option>shipped</option>
          </select>
        </Row>
        <Row k="confidence" type="number">
          <input type="number" style={{...propInput, width: 70 }} defaultValue="0.85" />
        </Row>
        <Row k="published" type="bool" canonical>
          <Toggle on />
        </Row>
        <Row k="created" type="date" canonical>
          <input type="date" style={{ ...propInput, fontFamily: "var(--font-mono)", fontSize: 11.5 }} defaultValue="2026-05-04" />
        </Row>
        <Row k="based-on" type="link">
          <span style={wikiChip}>
            <Icon name="link" size={10} />
            approval-engine
          </span>
        </Row>
        <Row k="grounds" type="link">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            <span style={wikiChip}><Icon name="link" size={10} />toulmin-warrants</span>
            <span style={wikiChip}><Icon name="link" size={10} />popper-conjectures</span>
          </div>
        </Row>
        <Row k="raw-yaml" type="raw">
          <div style={{
            fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-muted)",
            background: "var(--bg-inset)", padding: "3px 7px", borderRadius: 4,
            border: "1px solid var(--border)", whiteSpace: "nowrap",
            overflow: "hidden", textOverflow: "ellipsis",
          }}>
            schedule: {"{"} cron: "0 9 * * *" {"}"}
          </div>
        </Row>
      </div>
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "8px 16px",
        borderTop: "1px solid var(--border)",
      }}>
        <Icon name="plus" size={11} color="var(--text-muted)" />
        <input style={propInput} placeholder="Add a property…" />
      </div>
      <div style={{ padding: "0 16px 12px", display: "flex", flexWrap: "wrap", gap: 4 }}>
        {["tags", "summary", "thumbnail", "epistemic_status"].map((s) => (
          <button key={s} style={canonChip}>+ {s}</button>
        ))}
      </div>
    </PanelFrame>
  );
};

function typeIcon(type) {
  switch (type) {
    case "text": return "outline";
    case "number": return "tables";
    case "bool": return "check";
    case "date": return "bookmark";
    case "list": return "tags";
    case "link": return "link";
    case "enum": return "properties";
    case "raw": return "query";
    default: return "dot";
  }
}

const propInput = {
  width: "100%", padding: "3px 7px", border: "1px solid transparent",
  borderRadius: 4, background: "transparent", color: "var(--text)",
  fontFamily: "var(--font-sans)", fontSize: 12, outline: "none",
};
const propSelect = {
  ...propInput, background: "var(--bg-inset)",
  border: "1px solid var(--border)",
};
const chipStyle = {
  display: "inline-flex", alignItems: "center", gap: 4,
  padding: "1px 6px", background: "var(--bg-inset)",
  border: "1px solid var(--border)",
  color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 11,
  borderRadius: 4,
};
const wikiChip = {
  display: "inline-flex", alignItems: "center", gap: 4,
  padding: "1px 7px",
  background: "color-mix(in oklch, var(--accent) 12%, transparent)",
  color: "var(--accent)", borderRadius: 4,
  fontFamily: "var(--font-mono)", fontSize: 11,
  maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  minWidth: 0,
};
const canonChip = {
  padding: "2px 8px", background: "transparent",
  border: "1px dashed var(--border-strong)",
  borderRadius: 999, color: "var(--text-muted)",
  fontFamily: "var(--font-sans)", fontSize: 10.5,
  cursor: "pointer",
};
const Toggle = ({ on }) => (
  <span style={{
    display: "inline-flex", width: 28, height: 16, borderRadius: 999,
    background: on ? "var(--accent)" : "var(--border-strong)",
    position: "relative", cursor: "pointer", verticalAlign: "middle",
  }}>
    <span style={{
      position: "absolute", top: 2, left: on ? 14 : 2,
      width: 12, height: 12, borderRadius: 999,
      background: "white", boxShadow: "0 1px 2px rgba(0,0,0,.2)",
    }} />
  </span>
);

// ── OUTGOING / BACKLINKS ───────────────────────────────────────────────
const LinkGroup = ({ kind, color, links, defaultOpen = true }) => (
  <div>
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "6px 16px",
      cursor: "pointer",
    }}>
      <Icon name={defaultOpen ? "chevronDown" : "chevronRight"}
            size={10} color="var(--text-faint)" />
      <span style={{
        display: "inline-block", width: 7, height: 7, borderRadius: 2,
        background: color, marginRight: 2,
      }} />
      <span style={{
        fontSize: 11.5, fontWeight: 500, color: "var(--text)",
        fontFamily: "var(--font-mono)",
      }}>{kind}</span>
      <span style={{
        marginLeft: "auto", fontSize: 10.5, color: "var(--text-faint)",
        fontFamily: "var(--font-mono)",
      }}>{links.length}</span>
    </div>
    {defaultOpen && links.map((l, i) => (
      <div key={i} style={{
        padding: "5px 16px 5px 36px",
        display: "flex", alignItems: "baseline", gap: 6,
        cursor: "pointer",
      }}>
        <Icon name={l.broken ? "warn" : "notes"} size={11}
              color={l.broken ? "var(--rust)" : "var(--text-muted)"} />
        <span style={{
          fontSize: 12.5,
          color: l.broken ? "var(--rust)" : "var(--text)",
          flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{l.title}</span>
        {l.count > 1 && (
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: 10,
            color: "var(--text-faint)", fontVariantNumeric: "tabular-nums",
          }}>×{l.count}</span>
        )}
      </div>
    ))}
  </div>
);

const OutgoingPanel = ({ vars }) => (
  <PanelFrame vars={vars} title="Outgoing" sub="Outgoing links · 9" count={9}
              actions={<button style={tinyBtn}><Icon name="search" size={11} /></button>}>
    <LinkGroup kind="links-to" color="var(--accent)" links={[
      { title: "approval-engine", count: 3 },
      { title: "trust-tiers", count: 1 },
      { title: "raft", count: 1 },
      { title: "missing-node", count: 1, broken: true },
    ]} />
    <LinkGroup kind="supports" color="var(--sage)" links={[
      { title: "epistemic-defects", count: 2 },
      { title: "toulmin-warrants", count: 1 },
    ]} />
    <LinkGroup kind="refutes" color="var(--rust)" links={[
      { title: "popper-conjectures", count: 1 },
    ]} defaultOpen={false} />
  </PanelFrame>
);

const BacklinksPanel = ({ vars }) => (
  <PanelFrame vars={vars} title="Backlinks" sub="Linked mentions · 7" count={7}
              actions={<button style={tinyBtn}><Icon name="search" size={11} /></button>}>
    <LinkGroup kind="links-to" color="var(--accent)" links={[
      { title: "index", count: 1 },
      { title: "essays/approval-tiers", count: 2 },
      { title: "ontology/write-guard", count: 1 },
    ]} />
    <LinkGroup kind="supports" color="var(--sage)" links={[
      { title: "journal/2026-w20", count: 1 },
    ]} />
    <LinkGroup kind="grounds" color="var(--iris)" links={[
      { title: "essays/why-proposals", count: 1 },
      { title: "claims/llm-write-paths", count: 1 },
    ]} />
  </PanelFrame>
);

// ── TAGS (note-specific tag tree) ──────────────────────────────────────
const TagsRightPanel = ({ vars }) => {
  const Row = ({ depth, name, count, hasChildren, expanded, active }) => (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "5px 16px",
      paddingLeft: 16 + depth * 14,
      background: active ? "color-mix(in oklch, var(--accent) 12%, transparent)" : "transparent",
      borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent",
      cursor: "pointer",
    }}>
      {hasChildren
        ? <Icon name={expanded ? "chevronDown" : "chevronRight"} size={10} color="var(--text-faint)" />
        : <span style={{ width: 10 }} />}
      <span style={{
        fontFamily: "var(--font-mono)", fontSize: 12,
        color: active ? "var(--accent)" : "var(--text)",
        flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{name}</span>
      <span style={{
        fontFamily: "var(--font-mono)", fontSize: 10,
        color: active ? "var(--accent-dim)" : "var(--text-faint)",
        fontVariantNumeric: "tabular-nums",
      }}>{count}</span>
    </div>
  );
  return (
    <PanelFrame vars={vars} title="Tags" sub="Project tag tree" count="63"
                actions={<button style={tinyBtn}><Icon name="search" size={11} /></button>}>
      <Row depth={0} name="claim" count={89} hasChildren expanded />
      <Row depth={1} name="claim/grounded" count={47} active />
      <Row depth={1} name="claim/disputed" count={32} />
      <Row depth={1} name="claim/decided" count={10} />
      <Row depth={0} name="epistemology" count={47} hasChildren />
      <Row depth={0} name="warrant" count={31} hasChildren expanded />
      <Row depth={1} name="warrant/strong" count={18} />
      <Row depth={1} name="warrant/weak" count={13} />
      <Row depth={0} name="draft" count={23} />
      <Row depth={0} name="entrypoint" count={8} />

      {/* notes-for-selected-tag section */}
      <div style={{
        borderTop: "1px solid var(--border)",
        padding: "10px 16px 6px",
        display: "flex", alignItems: "baseline", justifyContent: "space-between",
      }}>
        <div style={{
          fontFamily: "var(--font-mono)", fontSize: 10,
          color: "var(--text-faint)", letterSpacing: ".06em", textTransform: "uppercase",
        }}>Notes with #claim/grounded</div>
        <span style={{ fontSize: 10.5, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>47</span>
      </div>
      <div style={{ padding: "0 0 8px" }}>
        {[
          "essays/why-proposals",
          "ontology/write-guard",
          "essays/approval-tiers",
        ].map((n) => (
          <div key={n} style={{
            padding: "3px 16px", display: "flex", alignItems: "center", gap: 6,
            fontSize: 12, color: "var(--text)", cursor: "pointer",
          }}>
            <Icon name="notes" size={11} color="var(--text-faint)" />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n}</span>
          </div>
        ))}
        <div style={{ padding: "3px 16px", color: "var(--text-faint)", fontSize: 11, fontStyle: "italic" }}>
          …and 44 more
        </div>
      </div>
    </PanelFrame>
  );
};

// ── TABLES (referenced in note) ────────────────────────────────────────
const TablesRightPanel = ({ vars }) => (
  <PanelFrame vars={vars} title="Tables" sub="Referenced in this note" count={3}>
    {[
      { name: "claims_by_status", rows: 184, cols: 5 },
      { name: "approval_tiers", rows: 3, cols: 4 },
      { name: "warrants_by_strength", rows: 31, cols: 4 },
    ].map((t) => (
      <div key={t.name} style={{
        padding: "9px 16px", borderTop: "1px solid var(--border)",
        display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
      }}>
        <Icon name="tables" size={14} color="var(--text-muted)" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text)" }}>{t.name}</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--text-faint)", marginTop: 1 }}>
            {t.rows} × {t.cols}
          </div>
        </div>
        <button style={{ ...tinyBtn, gap: 4, color: "var(--accent)", display: "inline-flex", padding: "3px 7px", fontSize: 10.5, width: "auto" }}>
          <Icon name="query" size={11} /> SELECT *
        </button>
      </div>
    ))}
  </PanelFrame>
);

// ── CITATIONS ──────────────────────────────────────────────────────────
const CitationsRightPanel = ({ vars }) => {
  const sources = [
    {
      title: "Republic", byline: "Plato · 375 BCE", id: "plato_republic", cites: 5, quotes: 3, expanded: true,
      excerpts: [
        { text: "Justice is the having and doing of one's own.", locator: "p. 433a", count: 2 },
        { text: "The state is the soul writ large.", locator: "p. 368e", count: 1 },
      ],
    },
    {
      title: "The Uses of Argument", byline: "Toulmin · 1958", id: "toulmin_1958", cites: 9, quotes: 4, expanded: true,
      excerpts: [
        { text: "Warrants are the inference licenses connecting data to claim.", locator: "ch. 3", count: 3 },
        { text: "Backing is what stands behind the warrant.", locator: "ch. 3", count: 1 },
      ],
    },
    {
      title: "Conjectures & Refutations", byline: "Popper · 1963", id: "popper_1963", cites: 4, quotes: 0,
    },
    {
      title: "[missing: Quine_1951]", byline: "9 references · uncited", id: "quine_1951", missing: true,
    },
  ];
  return (
    <PanelFrame vars={vars} title="Citations" sub="Sources cited from this note" count={4}>
      {sources.map((s, i) => (
        <div key={i} style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
          <div style={{
            display: "flex", alignItems: "baseline", gap: 8,
            padding: "9px 16px", cursor: "pointer",
          }}>
            {s.excerpts ? <Icon name="chevronDown" size={10} color="var(--text-faint)" /> : <span style={{ width: 10 }} />}
            <Icon name="source" size={13} color={s.missing ? "var(--rust)" : "var(--text-muted)"} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontFamily: "var(--font-display)", fontStyle: "italic",
                fontSize: 13, color: s.missing ? "var(--rust)" : "var(--text)",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}>{s.title}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>{s.byline}</div>
            </div>
            {!s.missing && (
              <span style={{
                fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-faint)",
                display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 1,
              }}>
                <span>{s.cites} cites</span>
                {s.quotes > 0 && <span style={{ color: "var(--accent)" }}>{s.quotes} quotes</span>}
              </span>
            )}
          </div>
          {s.excerpts?.map((ex, ei) => (
            <div key={ei} style={{
              padding: "6px 16px 6px 44px",
              borderLeft: "2px solid color-mix(in oklch, var(--accent) 14%, transparent)",
              marginLeft: 22,
            }}>
              <div style={{
                fontFamily: "var(--font-display)", fontStyle: "italic",
                fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.45,
              }}>“{ex.text}”</div>
              <div style={{
                display: "flex", justifyContent: "space-between", marginTop: 3,
                fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-faint)",
              }}>
                <span>{ex.locator}</span>
                {ex.count > 1 && <span>×{ex.count}</span>}
              </div>
            </div>
          ))}
        </div>
      ))}
    </PanelFrame>
  );
};

// ── BOOKMARKS ──────────────────────────────────────────────────────────
const BookmarksRightPanel = ({ vars }) => {
  const Item = ({ depth, kind, name, sub }) => (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "6px 16px",
      paddingLeft: 16 + depth * 14,
      cursor: "pointer",
    }}>
      <Icon name={
        kind === "folder-open" ? "chevronDown" :
        kind === "folder-closed" ? "chevronRight" :
        "bookmark"
      } size={kind === "bookmark" ? 12 : 10}
            color={kind === "bookmark" ? "var(--accent)" : "var(--text-faint)"} />
      {kind?.startsWith("folder") && <Icon name="folder" size={13} color="var(--text-muted)" />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, color: "var(--text)" }}>{name}</div>
        {sub && <div style={{ fontSize: 10.5, color: "var(--text-faint)", fontFamily: "var(--font-mono)", marginTop: 1 }}>{sub}</div>}
      </div>
    </div>
  );
  return (
    <PanelFrame vars={vars} title="Bookmarks" sub="Quick access" count={11}
                actions={
                  <>
                    <button style={tinyBtn}><Icon name="plus" size={11} /></button>
                    <button style={tinyBtn}><Icon name="folder" size={11} /></button>
                  </>
                }>
      <Item depth={0} kind="folder-open" name="Frequently visited" />
      <Item depth={1} kind="bookmark" name="On the trust principle" sub="essays/" />
      <Item depth={1} kind="bookmark" name="Approval tiers" sub="essays/" />
      <Item depth={1} kind="bookmark" name="Epistemic defects" sub="ontology/" />
      <Item depth={0} kind="folder-open" name="Research backlog" />
      <Item depth={1} kind="bookmark" name="Toulmin's warrants" sub="claims/" />
      <Item depth={1} kind="bookmark" name="Popper conjectures" sub="claims/" />
      <Item depth={0} kind="folder-closed" name="Reading queue" sub="4 items" />
      <Item depth={0} kind="bookmark" name="Daily journal" sub="journal/index" />
    </PanelFrame>
  );
};

// ── PROPOSALS ──────────────────────────────────────────────────────────
const ProposalsRightPanel = ({ vars }) => {
  const proposals = [
    { type: "create_note", note: "essays/approval-tiers", effects: "2 notes · 1 claim", by: "claude-opus-4-1", time: "now", status: "pending", selected: true },
    { type: "link_claim", note: "essays/on-the-trust-principle", effects: "1 supports · 1 grounds", by: "claude-opus-4-1", time: "12m", status: "pending" },
    { type: "tag_addition", note: "journal/2026-w20", effects: "3 tags", by: "auto-tag", time: "1h", status: "pending" },
    { type: "create_note", note: "raft/joint-consensus", effects: "1 note", by: "claude-opus-4-1", time: "Mon", status: "approved" },
    { type: "create_note", note: "ontology/inspection-rule", effects: "1 inspection rule", by: "claude-opus-4-1", time: "Mon", status: "rejected" },
  ];
  const filterCounts = { pending: 3, approved: 1, rejected: 1, all: 5 };
  return (
    <PanelFrame vars={vars} title="Proposals" sub="Pending review" count={3}
                actions={<button style={tinyBtn}><Icon name="search" size={11} /></button>}>
      {/* status filter tabs */}
      <div style={{
        display: "flex", padding: "0 16px 10px", gap: 5,
        borderBottom: "1px solid var(--border)",
      }}>
        {[
          { id: "pending", label: "Pending", count: filterCounts.pending, active: true },
          { id: "approved", label: "Approved", count: filterCounts.approved },
          { id: "rejected", label: "Rejected", count: filterCounts.rejected },
          { id: "all", label: "All", count: filterCounts.all },
        ].map((t) => (
          <button key={t.id} style={{
            padding: "3px 9px", borderRadius: 999, border: "none",
            background: t.active ? "color-mix(in oklch, var(--accent) 16%, transparent)" : "transparent",
            color: t.active ? "var(--accent)" : "var(--text-muted)",
            fontSize: 11, cursor: "pointer", fontFamily: "inherit",
            display: "inline-flex", alignItems: "center", gap: 4,
          }}>
            {t.label}
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 9.5,
              color: t.active ? "var(--accent-dim)" : "var(--text-faint)",
            }}>{t.count}</span>
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: "hidden" }}>
        {proposals.map((p, i) => (
          <div key={i} style={{
            padding: "10px 16px",
            borderBottom: "1px solid var(--border)",
            background: p.selected ? "color-mix(in oklch, var(--accent) 8%, transparent)" : "transparent",
            borderLeft: p.selected ? "2px solid var(--accent)" : "2px solid transparent",
            cursor: "pointer",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
              <span style={{
                fontFamily: "var(--font-mono)", fontSize: 10,
                padding: "1px 6px", borderRadius: 4,
                background: p.status === "approved" ? "color-mix(in oklch, var(--sage) 18%, transparent)" :
                            p.status === "rejected" ? "var(--bg-inset)" :
                            "color-mix(in oklch, var(--accent) 18%, transparent)",
                color: p.status === "approved" ? "var(--sage)" :
                       p.status === "rejected" ? "var(--text-faint)" :
                       "var(--accent)",
                textTransform: "uppercase", letterSpacing: ".04em",
              }}>{p.status}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text)" }}>
                {p.type}
              </span>
              <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-faint)" }}>{p.time}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--text-muted)" }}>
              <Icon name="notes" size={11} color="var(--text-faint)" />
              <span style={{
                fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{p.note}</span>
            </div>
            <div style={{ marginTop: 4, fontSize: 11, color: "var(--text-muted)" }}>
              → <span style={{ color: "var(--text)" }}>{p.effects}</span>
              <span style={{ marginLeft: 6, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>
                · by {p.by}
              </span>
            </div>
            {p.selected && p.status === "pending" && (
              <div style={{ display: "flex", gap: 5, marginTop: 8 }}>
                <button style={{
                  flex: 1, padding: "5px 8px", borderRadius: 5, border: "none",
                  background: "var(--accent)", color: "var(--accent-ink)",
                  fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4,
                }}><Icon name="check" size={10} /> Approve</button>
                <button style={{
                  flex: 1, padding: "5px 8px", borderRadius: 5,
                  border: "1px solid var(--border)", background: "transparent",
                  color: "var(--text-muted)", fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                }}>Reject</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </PanelFrame>
  );
};

// ── FOOTNOTES ──────────────────────────────────────────────────────────
const FootnotesRightPanel = ({ vars }) => {
  const fns = [
    { label: "1", body: "See Toulmin (1958) on warrants as inference licenses.", n: 2 },
    { label: "2", body: "The cron syntax follows POSIX semantics.", n: 1 },
    { label: "approval-engine", body: "Located at src/main/llm/approval.ts.", n: 1 },
    { label: "missing-ref", body: "Footnote referenced but never defined.", kind: "missing" },
    { label: "orphan-3", body: "Never appears in body — likely an old artifact.", kind: "orphan" },
  ];
  return (
    <PanelFrame vars={vars} title="Footnotes" sub="In this note" count={5}
                actions={<button style={tinyBtn}><Icon name="plus" size={11} /></button>}>
      {fns.map((f, i) => (
        <div key={i} style={{
          padding: "9px 16px",
          borderTop: "1px solid var(--border)",
          display: "flex", gap: 10, alignItems: "flex-start",
          opacity: f.kind ? .8 : 1,
          cursor: "pointer",
        }}>
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: 11,
            padding: "1px 6px", borderRadius: 4,
            background: f.kind === "missing" ? "color-mix(in oklch, var(--rust) 14%, transparent)" :
                        f.kind === "orphan" ? "var(--bg-inset)" :
                        "color-mix(in oklch, var(--accent) 14%, transparent)",
            color: f.kind === "missing" ? "var(--rust)" :
                   f.kind === "orphan" ? "var(--text-faint)" :
                   "var(--accent)",
            flexShrink: 0,
          }}>[^{f.label}]</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.4 }}>{f.body}</div>
            {f.kind && (
              <div style={{
                marginTop: 3, fontSize: 10, color: "var(--rust)",
                fontFamily: "var(--font-mono)", letterSpacing: ".04em",
              }}>{f.kind === "missing" ? "REFERENCED · NOT DEFINED" : "DEFINED · NEVER USED"}</div>
            )}
          </div>
          {f.n > 1 && (
            <span style={{
              fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-faint)",
              fontVariantNumeric: "tabular-nums",
            }}>×{f.n}</span>
          )}
        </div>
      ))}
    </PanelFrame>
  );
};

window.MinervaRightPanels = {
  PropertiesPanel,
  OutgoingPanel,
  BacklinksPanel,
  TagsRightPanel,
  TablesRightPanel,
  CitationsRightPanel,
  BookmarksRightPanel,
  ProposalsRightPanel,
  FootnotesRightPanel,
};
