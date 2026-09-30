import React from "react";

// ── Browser / web-app scene ────────────────────────────────────────────────
// A clean framed window for showing a product screenshot or live HTML.
// `chrome="bar"` draws a minimal browser top bar with the title; "none"
// shows the bare framed surface (use when the screenshot already includes
// its own header). Children render on top (cursor, overlays, callouts).
// Pick this for web apps, docs, dashboards, SaaS launches.

export const BrowserWindow: React.FC<{
  w: number;
  h: number;
  title?: string;
  chrome?: "bar" | "none";
  children?: React.ReactNode;
}> = ({ w, h, title, chrome = "none", children }) => (
  <div
    style={{
      width: w,
      height: h,
      borderRadius: 12,
      overflow: "hidden",
      boxShadow: "0 28px 70px rgba(40,70,55,0.26)",
      background: "#fff",
      position: "relative",
    }}
  >
    {chrome === "bar" ? (
      <div
        style={{
          height: 40,
          background: "#f1f1f1",
          borderBottom: "1px solid #e3e3e3",
          display: "flex",
          alignItems: "center",
          paddingLeft: 14,
          gap: 7,
          position: "relative",
        }}
      >
        <div style={{ width: 11, height: 11, borderRadius: "50%", background: "#ff5f57" }} />
        <div style={{ width: 11, height: 11, borderRadius: "50%", background: "#febc2e" }} />
        <div style={{ width: 11, height: 11, borderRadius: "50%", background: "#28c840" }} />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            textAlign: "center",
            color: "#666",
            fontSize: 13,
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
          }}
        >
          {title}
        </div>
      </div>
    ) : null}
    {children}
  </div>
);
