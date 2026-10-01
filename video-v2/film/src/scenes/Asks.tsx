import { AbsoluteFill } from "remotion";
import { Caption, Footnote, Highlight, Reveal, Screen } from "../parts";
import { C, FONT } from "../theme";

/**
 * Scene 5, "The agent asks before acting". A permit application arrives;
 * the agent checks it against standing decisions in the real product, and
 * the real answer is Stop (ui/check.png, from the live engine).
 */
const SCREEN = { left: 760, top: 300, width: 1040 };

export function Asks() {
  return (
    <AbsoluteFill style={{ background: C.paper }}>
      <Caption at={6} out={176}>
        Before it acts, the agent asks.
      </Caption>
      <Caption at={190}>
        The answer: <span style={{ color: C.red }}>stop.</span> This needs a person.
      </Caption>

      <Reveal at={20} style={{ position: "absolute", left: 140, top: 300, width: 540, padding: "26px 30px", border: `1px solid ${C.hair}`, borderRadius: 4, fontFamily: FONT }}>
        <div style={{ fontSize: 22, color: C.muted }}>New permit application</div>
        <div style={{ marginTop: 6, fontSize: 36, fontWeight: 600, color: C.ink }}>60-bed care home</div>
        <div style={{ marginTop: 2, fontSize: 26, color: C.soft }}>12 Quay Road, east bank</div>
      </Reveal>
      <Reveal at={56} style={{ position: "absolute", left: 140, top: 520, width: 540, fontFamily: FONT }}>
        <div style={{ fontSize: 22, color: C.muted }}>permit agent</div>
        <div style={{ marginTop: 6, padding: "18px 22px", border: `2px solid ${C.blue}`, borderRadius: 4, fontSize: 28, lineHeight: 1.3, color: C.ink }}>
          Before I approve this: does any decision govern the east bank?
        </div>
      </Reveal>
      <Reveal at={150} style={{ position: "absolute", left: 140, top: 720, width: 540, fontFamily: FONT, fontSize: 24, lineHeight: 1.4, color: C.soft }}>
        Care homes on the east bank need a flood review, and the flood assumption behind four decisions no longer holds.
      </Reveal>

      <Reveal at={84}>
        <Screen
          src="ui/check.png"
          {...SCREEN}
          from={{ x: 1010, y: 520, scale: 1 }}
          to={{ x: 1013, y: 690, scale: 1.37 }}
          moveAt={150}
          moveFor={45}
        />
      </Reveal>
      {/* The verdict box in check.png (x 336–1690, y 692–1036), mapped through the camera above. */}
      <Highlight at={205} left={772} top={588} width={1016} height={268} />
      <Footnote>The real product, running on a fictional city's data.</Footnote>
    </AbsoluteFill>
  );
}
