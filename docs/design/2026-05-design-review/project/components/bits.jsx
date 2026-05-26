// Shared visual primitives: artboard frames, annotation pills, comparison rows.

const { tokenVars } = window.MinervaTokens;
const Icon = window.MinervaIcon;

// A self-contained mini-app frame using current Catppuccin tokens (verbatim
// from src/renderer/styles/global.css so the "current" half is honest).
const CATPPUCCIN = {
  dark: {
    bg: "#1e1e2e", bgTitlebar: "#181825", bgSidebar: "#1e1e2e",
    bgButton: "#313244", bgButtonHover: "#45475a",
    text: "#cdd6f4", textMuted: "#6c7086", border: "#313244",
    accent: "#89b4fa",
  },
  light: {
    bg: "#eff1f5", bgTitlebar: "#e6e9ef", bgSidebar: "#eff1f5",
    bgButton: "#ccd0da", bgButtonHover: "#bcc0cc",
    text: "#4c4f69", textMuted: "#8c8fa1", border: "#ccd0da",
    accent: "#1e66f5",
  },
};

const catVars = (mode) => {
  const c = CATPPUCCIN[mode];
  return {
    "--bg": c.bg, "--bg-titlebar": c.bgTitlebar, "--bg-sidebar": c.bgSidebar,
    "--bg-button": c.bgButton, "--bg-button-hover": c.bgButtonHover,
    "--text": c.text, "--text-muted": c.textMuted, "--border": c.border,
    "--accent": c.accent,
    background: c.bg, color: c.text,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    fontSize: "13px",
  };
};

// Surface frame — a card-y container that fills the artboard. Provides theme
// vars + standard scrollbar suppression + a soft inner ring.
const Surface = ({ children, vars, style, ...rest }) => (
  <div
    style={{
      width: "100%",
      height: "100%",
      overflow: "hidden",
      position: "relative",
      ...vars,
      ...style,
    }}
    {...rest}
  >
    {children}
  </div>
);

// "current" / "proposed" caption strip drawn above an artboard. Lives outside
// the surface (z=2) so it doesn't bleed into the design.
const CaptionTag = ({ kind = "current", children, style }) => {
  const palette = kind === "current"
    ? { bg: "rgba(150,130,90,.12)", color: "rgba(80,60,30,.85)", border: "rgba(140,110,70,.3)" }
    : { bg: "rgba(70,130,90,.12)", color: "rgba(40,90,55,.9)", border: "rgba(70,130,90,.35)" };
  return (
    <div style={{
      position: "absolute", top: -28, left: 0,
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "4px 10px", borderRadius: 999,
      background: palette.bg, color: palette.color,
      border: `1px solid ${palette.border}`,
      fontSize: 11, fontWeight: 600, letterSpacing: ".04em",
      textTransform: "uppercase",
      fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
      ...style,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: 999,
        background: palette.color, opacity: .8,
      }} />
      {children}
    </div>
  );
};

// Annotation pin — a small numbered circle anchored to an x/y point with a
// callout label. Used to flag specific design moves on the "proposed" half.
const Pin = ({ n, x, y, label, side = "right", offset = 24 }) => {
  const isRight = side === "right";
  return (
    <div style={{
      position: "absolute", left: x, top: y,
      transform: "translate(-50%, -50%)",
      zIndex: 4, pointerEvents: "none",
    }}>
      <div style={{
        width: 18, height: 18, borderRadius: 999,
        background: "oklch(0.56 0.115 65)",
        color: "oklch(0.98 0.01 85)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 10, fontWeight: 700,
        fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
        boxShadow: "0 1px 3px rgba(0,0,0,.25), 0 0 0 2px rgba(255,255,255,.6)",
      }}>{n}</div>
      {label && (
        <div style={{
          position: "absolute",
          [isRight ? "left" : "right"]: offset,
          top: "50%", transform: "translateY(-50%)",
          whiteSpace: "nowrap",
          padding: "3px 8px",
          background: "rgba(40,30,20,.92)",
          color: "#f1ece0",
          fontSize: 11, lineHeight: 1.35,
          fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
          borderRadius: 4,
          maxWidth: 220, whiteSpace: "normal",
        }}>{label}</div>
      )}
    </div>
  );
};

// Soft divider used inside artboards.
const Hairline = ({ vertical, style }) => (
  <div style={{
    background: "var(--border)",
    ...(vertical ? { width: 1, height: "100%" } : { height: 1, width: "100%" }),
    ...style,
  }} />
);

// IDE window frame — traffic lights + a faint top edge. Used to anchor
// mini-app artboards so they read as application chrome.
const TrafficLights = () => (
  <div style={{
    display: "flex", gap: 8, padding: "0 14px",
    alignItems: "center", height: "100%",
  }}>
    {["#ff5f57", "#febc2e", "#28c840"].map((c, i) => (
      <span key={i} style={{
        width: 12, height: 12, borderRadius: 999, background: c,
        boxShadow: "inset 0 0 0 .5px rgba(0,0,0,.18)",
      }} />
    ))}
  </div>
);

window.MinervaBits = {
  CATPPUCCIN, catVars, Surface, CaptionTag, Pin, Hairline, TrafficLights,
};
