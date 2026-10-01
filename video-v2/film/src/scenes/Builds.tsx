import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Caption, Footnote, Reveal, useProgress } from "../parts";
import { C, FONT, MONO } from "../theme";

/**
 * Scene 2, "A city builds on it". The 2.4 m mark from the opening becomes
 * the shared assumption; four decisions by four teams rise from it, each with
 * the alternative it rejected. Then people move on and agents keep following.
 * Decision text paraphrases video-v2/scenario/decisions.json.
 */
const LINE_Y = 640;

const DECISIONS = [
  { ref: "PLN-014", team: "Education", title: "Build the new school on the river terrace", rejected: "Hilltop site: too far to walk" },
  { ref: "HLT-006", team: "Health", title: "Keep hospital generators on the ground floor", rejected: "Roof: work the study said wasn't needed" },
  { ref: "EMR-003", team: "Emergency", title: "Evacuate over the Mill Street bridge", rejected: "Ring road: eleven minutes slower" },
  { ref: "PLN-021", team: "Permits", title: "Approve east-bank homes without a flood review", rejected: "Review every permit: months of delay" },
];

function DecisionCard({ i, appear }: { i: number; appear: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const d = DECISIONS[i];
  const s = spring({ frame: frame - appear, fps, config: { damping: 200, mass: 0.8 } });
  const left = 140 + i * 420;
  const stem = interpolate(frame, [appear, appear + 16], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <>
      <div style={{ position: "absolute", left: left + 190, top: 520 + (1 - stem) * 120, width: 2, height: 120 * stem, background: C.blue }} />
      <div
        style={{
          position: "absolute",
          left,
          top: 300,
          width: 380,
          height: 220,
          padding: "18px 22px",
          background: C.paper,
          border: `1px solid ${C.hair}`,
          borderRadius: 4,
          fontFamily: FONT,
          opacity: s,
          transform: `translateY(${(1 - s) * 40}px)`,
        }}
      >
        <div style={{ fontFamily: MONO, fontSize: 19, color: C.muted }}>
          {d.ref} · {d.team}
        </div>
        <div style={{ marginTop: 8, fontSize: 28, lineHeight: 1.2, fontWeight: 600, color: C.ink }}>{d.title}</div>
        <div style={{ marginTop: 12, fontSize: 19, lineHeight: 1.3, color: C.soft }}>Rejected: {d.rejected}</div>
      </div>
    </>
  );
}

function AgentRow({ at, y, text }: { at: number; y: number; text: string }) {
  const frame = useCurrentFrame();
  const pulse = 0.5 + 0.5 * Math.sin((frame - at) / 6);
  return (
    <Reveal at={at} style={{ position: "absolute", left: 140, top: y, display: "flex", alignItems: "center", gap: 16, fontFamily: FONT, fontSize: 26, color: C.soft }}>
      <span style={{ width: 12, height: 12, background: C.ink, opacity: 0.4 + 0.6 * pulse }} />
      <span style={{ color: C.ink, fontWeight: 600 }}>permit agent</span>
      <span>{text}</span>
    </Reveal>
  );
}

export function Builds() {
  // The opening's mark ran from the left bank (x≈331) to the wall (x=1180). Extend it across the frame.
  const grow = useProgress(0, 22);
  const x0 = 331 - (331 - 140) * grow;
  const x1 = 1180 + (1780 - 1180) * grow;
  const lineFade = useProgress(300, 330);
  return (
    <AbsoluteFill style={{ background: C.paper }}>
      <div style={{ position: "absolute", left: x0, top: LINE_Y, width: x1 - x0, borderTop: `3px dashed ${C.blue}`, opacity: 1 - lineFade * 0.5 }} />
      <Reveal at={18} style={{ position: "absolute", left: 140, top: LINE_Y + 18, fontFamily: FONT }}>
        <div style={{ fontSize: 20, color: C.muted }}>The shared assumption</div>
        <div style={{ fontSize: 32, fontWeight: 600, color: C.blue }}>The 100-year flood on the east bank stays below 2.4 m</div>
      </Reveal>

      {DECISIONS.map((_, i) => (
        <DecisionCard key={i} i={i} appear={54 + i * 26} />
      ))}

      <Caption at={30} out={262}>
        Four teams. Four decisions.
        <br />
        <span style={{ color: C.blue }}>One shared assumption.</span>
      </Caption>
      <Caption at={282}>
        People move on.
        <br />
        Agents keep following the decisions.
      </Caption>

      <AgentRow at={300} y={800} text="approving east-bank permits, as PLN-021 says" />
      <AgentRow at={330} y={850} text="routing evacuation drills over the bridge, as EMR-003 says" />
      <AgentRow at={360} y={900} text="scheduling generator tests at ground level, as HLT-006 says" />
      <Footnote>Riverton is a fictional city.</Footnote>
    </AbsoluteFill>
  );
}
