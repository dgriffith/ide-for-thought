// Editor surface — margins, gutter, callouts, mermaid, math, wiki-links.

const { Surface, catVars } = window.MinervaBits;
const Icon = window.MinervaIcon;

// ── CURRENT ─────────────────────────────────────────────────────────────
const CurrentEditor = ({ mode }) => (
  <Surface vars={catVars(mode)}>
    <div style={{
      width: "100%", height: "100%", background: "var(--bg)", color: "var(--text)",
      display: "grid", gridTemplateColumns: "40px 1fr",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13, lineHeight: 1.5, overflow: "hidden",
    }}>
      {/* gutter */}
      <div style={{ color: "var(--text-muted)", padding: "12px 0", textAlign: "right" }}>
        {Array.from({ length: 26 }, (_, i) => (
          <div key={i} style={{ padding: "0 8px", height: 19.5 }}>{i + 1}</div>
        ))}
      </div>
      {/* content */}
      <div style={{ padding: "12px 12px 12px 4px", overflow: "hidden" }}>
        <div style={{ color: "var(--accent)" }}># On the trust principle</div>
        <div>&nbsp;</div>
        <div>The LLM proposes. The human confirms. This is the most important</div>
        <div>design decision in the system. All LLM-originated graph mutations</div>
        <div>must go through the <span style={{ color: "var(--accent)" }}>[[approval-engine]]</span>.</div>
        <div>&nbsp;</div>
        <div style={{ color: "var(--accent)" }}>## Approval tiers</div>
        <div>&nbsp;</div>
        <div style={{ color: "var(--text-muted)" }}>{">"} [!note] Tiers map to trust level</div>
        <div style={{ color: "var(--text-muted)" }}>{">"} Each tier has its own gate.</div>
        <div>&nbsp;</div>
        <div>- <span style={{ color: "var(--accent)" }}>requires_approval</span> — new claims, evidence links</div>
        <div>- <span style={{ color: "var(--accent)" }}>notify_only</span> — confidence updates, status changes</div>
        <div>- <span style={{ color: "var(--accent)" }}>autonomous</span> — tag additions</div>
        <div>&nbsp;</div>
        <div style={{ color: "var(--accent)" }}>## Inline math</div>
        <div>&nbsp;</div>
        <div>The decay is $\lambda = -\ln(2)/t_{"{1/2}"}$ per the standard form.</div>
      </div>
    </div>
  </Surface>
);

// ── PROPOSED ────────────────────────────────────────────────────────────
const ProposedEditor = ({ vars, mode }) => {
  return (
    <Surface vars={vars}>
      <div style={{
        width: "100%", height: "100%", background: "var(--bg)", color: "var(--text)",
        display: "grid", gridTemplateColumns: "56px 1fr 1px",
        overflow: "hidden", position: "relative",
      }}>
        {/* gutter — quieter; current line + folded-region cues */}
        <div style={{
          padding: "32px 0", textAlign: "right",
          fontFamily: "var(--font-mono)", fontSize: 11,
          color: "var(--text-faint)",
        }}>
          {[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28].map((n) => (
            <div key={n} style={{
              padding: "0 10px", height: 23,
              color: n === 14 ? "var(--accent)" : (n === 11 ? "var(--accent-dim)" : "inherit"),
              borderRight: n === 14 ? "2px solid var(--accent)" : "none",
              marginRight: n === 14 ? -2 : 0,
            }}>{n}</div>
          ))}
        </div>

        {/* content — comfortable column, serif headings, mono body, real callouts */}
        <div style={{
          padding: "32px 0 32px 8px", overflow: "hidden",
          maxWidth: 720, fontFamily: "var(--font-mono)", fontSize: 13.5, lineHeight: 1.69,
        }}>
          {/* H1 — display serif */}
          <div style={{
            fontFamily: "var(--font-display)", fontSize: 30, lineHeight: 1.15,
            fontWeight: 500, letterSpacing: "-0.01em", margin: "0 0 4px",
            color: "var(--text)",
          }}>
            On the trust principle
          </div>
          <div style={{
            fontFamily: "var(--font-display)", fontStyle: "italic",
            fontSize: 13.5, color: "var(--text-muted)", margin: "0 0 28px",
          }}>
            How a knowledge graph stays the user's, not the model's.
          </div>

          {/* paragraph */}
          <div style={{ marginBottom: 18 }}>
            <Token c="var(--text)">The LLM proposes. The human confirms. This is the most important design decision in the system. All LLM-originated graph mutations</Token>{" "}
            <WikiChip>approval-engine</WikiChip>
            <Token c="var(--text)">.</Token>
          </div>

          {/* H2 */}
          <div style={{
            fontFamily: "var(--font-display)", fontSize: 22,
            fontWeight: 500, margin: "8px 0 12px",
            color: "var(--text)", letterSpacing: "-0.01em",
            display: "flex", alignItems: "baseline", gap: 10,
          }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--accent)" }}>§ 02</span>
            Approval tiers
          </div>

          {/* Callout — refined */}
          <Callout kind="note" title="Three tiers, one gate">
            All three tiers share the same approval-engine gate. The difference
            is what shows up in the user's review queue — and what doesn't.
          </Callout>

          {/* List with wiki-style affordance */}
          <ul style={{ paddingLeft: 22, margin: "16px 0", listStyle: "none" }}>
            {[
              { k: "requires_approval", v: "new claims, evidence links, component creation" },
              { k: "notify_only",       v: "confidence updates, status changes" },
              { k: "autonomous",        v: "tag additions, staleness flags" },
            ].map((row) => (
              <li key={row.k} style={{ display: "flex", gap: 12, padding: "3px 0", alignItems: "baseline" }}>
                <span style={{ color: "var(--accent)", marginLeft: -18, width: 10 }}>◦</span>
                <code style={{
                  background: "color-mix(in oklch, var(--accent) 14%, transparent)",
                  color: "var(--accent)",
                  padding: "1px 7px", borderRadius: 4,
                  fontFamily: "var(--font-mono)", fontSize: 12,
                }}>{row.k}</code>
                <span style={{ color: "var(--text-muted)" }}>— {row.v}</span>
              </li>
            ))}
          </ul>

          {/* H2 */}
          <div style={{
            fontFamily: "var(--font-display)", fontSize: 22,
            fontWeight: 500, margin: "20px 0 12px",
            color: "var(--text)", letterSpacing: "-0.01em",
            display: "flex", alignItems: "baseline", gap: 10,
          }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--accent)" }}>§ 03</span>
            Inline math &amp; mermaid
          </div>

          {/* math */}
          <div style={{ marginBottom: 18 }}>
            <Token c="var(--text)">The half-life decay constant is</Token>{" "}
            <span style={{
              padding: "2px 8px", background: "var(--bg-inset)",
              borderRadius: 4, border: "1px solid var(--border)",
              fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13,
            }}>
              λ = −ln(2) ÷ <i>t</i><sub style={{ fontSize: 9 }}>½</sub>
            </span>{" "}
            <Token c="var(--text)">— a standard form.</Token>
          </div>

          {/* mermaid block */}
          <div style={{
            background: "var(--bg-inset)",
            border: "1px solid var(--border)", borderRadius: 6,
            padding: "16px 20px", margin: "14px 0",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <MermaidSketch />
          </div>

          {/* code block */}
          <div style={{
            background: "var(--bg-inset)",
            border: "1px solid var(--border)", borderRadius: 6,
            padding: "12px 16px", marginTop: 14,
            position: "relative",
          }}>
            <div style={{
              position: "absolute", top: 8, right: 12,
              fontFamily: "var(--font-mono)", fontSize: 10,
              color: "var(--text-faint)", letterSpacing: ".08em", textTransform: "uppercase",
            }}>typescript</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.7 }}>
              <div><span style={{ color: "var(--iris)" }}>function</span> <span style={{ color: "var(--accent)" }}>enterLLMContext</span>() {"{"}</div>
              <div style={{ paddingLeft: 18 }}><span style={{ color: "var(--text-muted)" }}>// any direct store.add() call here logs a warning</span></div>
              <div style={{ paddingLeft: 18 }}><span style={{ color: "var(--text)" }}>store.context.kind = </span><span style={{ color: "var(--sage)" }}>'llm'</span>;</div>
              <div>{"}"}</div>
            </div>
          </div>
        </div>

        {/* right margin rail — minimap-ish scroll indicator */}
        <div style={{ borderLeft: "1px solid var(--border)" }} />
      </div>
    </Surface>
  );
};

const Token = ({ c, children }) => (
  <span style={{ color: c }}>{children}</span>
);

const WikiChip = ({ children }) => (
  <span style={{
    display: "inline-flex", alignItems: "center", gap: 4,
    padding: "1px 8px",
    background: "color-mix(in oklch, var(--accent) 12%, transparent)",
    color: "var(--accent)",
    borderRadius: 4,
    fontFamily: "var(--font-sans)",
    fontSize: 12.5,
  }}>
    <Icon name="link" size={11} />
    {children}
  </span>
);

const Callout = ({ kind = "note", title, children }) => {
  const accents = {
    note:    { c: "var(--accent)", icon: "outline" },
    tip:     { c: "var(--sage)",   icon: "sparkle" },
    warning: { c: "var(--rust)",   icon: "warn" },
    quote:   { c: "var(--iris)",   icon: "citations" },
  };
  const a = accents[kind];
  return (
    <div style={{
      borderRadius: 6,
      background: `color-mix(in oklch, ${a.c} 8%, transparent)`,
      border: `1px solid color-mix(in oklch, ${a.c} 28%, transparent)`,
      borderLeft: `3px solid ${a.c}`,
      padding: "10px 14px", margin: "16px 0",
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        color: a.c, fontWeight: 600, fontSize: 12.5,
        fontFamily: "var(--font-sans)", textTransform: "none",
        letterSpacing: ".01em", marginBottom: 4,
      }}>
        <Icon name={a.icon} size={13} />
        {title}
      </div>
      <div style={{ color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1.6 }}>
        {children}
      </div>
    </div>
  );
};

// A faux mermaid node-and-edge sketch as inline SVG, themed against tokens.
const MermaidSketch = () => (
  <svg width="420" height="100" viewBox="0 0 420 100" style={{ overflow: "visible" }}>
    {[
      { x: 16,  w: 80, label: "LLM" },
      { x: 130, w: 110, label: "Proposal" },
      { x: 270, w: 90, label: "Human" },
      { x: 200, y: 70, w: 110, label: "Graph", below: true },
    ].map((n, i) => (
      <g key={i}>
        <rect x={n.x} y={n.below ? 60 : 12} width={n.w} height="28" rx="6"
              fill="var(--bg-elev-2)" stroke="var(--border-strong)" />
        <text x={n.x + n.w / 2} y={n.below ? 78 : 30} textAnchor="middle"
              fontFamily="var(--font-mono)" fontSize="12" fill="var(--text)">{n.label}</text>
      </g>
    ))}
    {/* arrows */}
    {[
      { x1: 96,  x2: 130, y1: 26, y2: 26 },
      { x1: 240, x2: 270, y1: 26, y2: 26 },
      { x1: 315, x2: 285, y1: 40, y2: 60 },
    ].map((e, i) => (
      <g key={i}>
        <line x1={e.x1} y1={e.y1} x2={e.x2 - 5} y2={e.y2}
              stroke="var(--text-muted)" strokeWidth="1.4" />
        <path d={`M ${e.x2} ${e.y2} L ${e.x2 - 7} ${e.y2 - 3.5} L ${e.x2 - 7} ${e.y2 + 3.5} Z`}
              fill="var(--text-muted)" />
      </g>
    ))}
    <text x="113" y="22" fontSize="9.5" fontFamily="var(--font-mono)" fill="var(--text-faint)">writes</text>
    <text x="248" y="22" fontSize="9.5" fontFamily="var(--font-mono)" fill="var(--text-faint)">queues</text>
    <text x="318" y="56" fontSize="9.5" fontFamily="var(--font-mono)" fill="var(--accent)">approves</text>
  </svg>
);

window.MinervaEditor = { CurrentEditor, ProposedEditor };
