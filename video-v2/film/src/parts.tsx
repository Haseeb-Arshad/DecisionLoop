import type { CSSProperties, ReactNode } from "react";
import { Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, FONT } from "./theme";

const ease = Easing.bezier(0.33, 0, 0.2, 1);

/** 0→1 between two frames, eased. */
export function useProgress(from: number, to: number): number {
  const frame = useCurrentFrame();
  return interpolate(frame, [from, to], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
}

/** Fades and lifts its children in at `at`, and optionally out at `out`. */
export function Reveal({ at, out, children, style, lift = 16 }: { at: number; out?: number; children: ReactNode; style?: CSSProperties; lift?: number }) {
  const frame = useCurrentFrame();
  const inP = interpolate(frame, [at, at + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  const outP = out === undefined ? 0 : interpolate(frame, [out, out + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <div style={{ ...style, opacity: inP * (1 - outP), transform: `translateY(${(1 - inP) * lift}px)` }}>{children}</div>;
}

/** The headline at the top-left of a scene. Same position and size in every scene. */
export function Caption({ at, out, children, color = C.ink }: { at: number; out?: number; children: ReactNode; color?: string }) {
  return (
    <Reveal at={at} out={out} style={{ position: "absolute", left: 140, top: 96, width: 1500, fontFamily: FONT, fontSize: 56, lineHeight: 1.14, fontWeight: 600, letterSpacing: "-0.015em", color }}>
      {children}
    </Reveal>
  );
}

export function Footnote({ children }: { children: ReactNode }) {
  return <div style={{ position: "absolute", left: 140, bottom: 48, fontFamily: FONT, fontSize: 20, color: C.muted }}>{children}</div>;
}

export interface Camera {
  /** Point of the screenshot (in its 1920x1080 pixels) to centre in the frame. */
  x: number;
  y: number;
  scale: number;
}

/**
 * A real product screen in a plain frame, with a camera that moves between
 * two framings. Screens are 1920x1080 captures of the running product.
 */
export function Screen({
  src,
  left,
  top,
  width,
  from,
  to,
  moveAt,
  moveFor = 40,
  label = "DecisionLoop · Riverton City (fictional)",
}: {
  src: string;
  left: number;
  top: number;
  width: number;
  from: Camera;
  to?: Camera;
  moveAt?: number;
  moveFor?: number;
  label?: string;
}) {
  const frame = useCurrentFrame();
  const height = (width * 9) / 16;
  const p = to && moveAt !== undefined ? interpolate(frame, [moveAt, moveAt + moveFor], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease }) : 0;
  const cam = to ? { x: from.x + (to.x - from.x) * p, y: from.y + (to.y - from.y) * p, scale: from.scale + (to.scale - from.scale) * p } : from;
  const k = (width / 1920) * cam.scale;
  const tx = width / 2 - cam.x * k;
  const ty = height / 2 - cam.y * k;
  return (
    <div style={{ position: "absolute", left, top: top - 34 }}>
      <div style={{ fontFamily: FONT, fontSize: 18, color: C.muted, marginBottom: 10 }}>{label}</div>
      <div style={{ position: "relative", width, height, overflow: "hidden", border: `1px solid #d4d4d4`, borderRadius: 6, background: C.paper }}>
        <Img src={staticFile(src)} style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080, transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${k})` }} />
      </div>
    </div>
  );
}

/** A thin outline drawn over part of a screen to point at it. */
export function Highlight({ at, left, top, width, height, color = C.redMark }: { at: number; left: number; top: number; width: number; height: number; color?: string }) {
  const p = useProgress(at, at + 12);
  return <div style={{ position: "absolute", left, top, width, height, border: `3px solid ${color}`, borderRadius: 4, opacity: p, transform: `scale(${1.04 - 0.04 * p})` }} />;
}
